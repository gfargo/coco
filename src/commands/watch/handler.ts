import {
    AgentOperation,
    AgentOptions,
    AgentTaskInputSchema,
    ChangeSource,
    createAgentOperationContext,
    ResolvedChangeContext,
    resolveAgentRepoRoot,
    resolveChangeSource,
    runAgentOperation,
    toAgentOperationError,
} from '../../operations/agent'
import { createRepoChangeWatcher } from '../../lib/watcher/repoChangeWatcher'
import { createThrottledRunner } from '../../lib/watcher/throttledRunner'
import { CommandHandler } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'
import { WatchArgv } from './config'

export type WatchEvent =
  | { type: 'ready'; repoRoot: string; operations: AgentOperation[]; scope: 'staged' | 'worktree' }
  | { type: 'idle' }
  | { type: 'skipped'; reason: 'unchanged'; digest: string }
  | { type: 'running'; operation: AgentOperation }
  | { type: 'result'; operation: AgentOperation; data: unknown; warnings: string[] }
  | { type: 'error'; operation?: AgentOperation; code: string; message: string }
  | { type: 'stopped' }

function describeEvent(event: WatchEvent): string {
  switch (event.type) {
    case 'ready':
      return `Watching ${event.repoRoot} (${event.scope}) — running: ${event.operations.join(', ')}. Press Ctrl+C to stop.`
    case 'idle':
      return 'No changes detected.'
    case 'skipped':
      return 'Change set unchanged since the last run — skipping.'
    case 'running':
      return `Change set settled — running ${event.operation}...`
    case 'result':
      return `${event.operation} completed.${event.warnings.length ? ` Warnings: ${event.warnings.join('; ')}` : ''}`
    case 'error':
      return `${event.operation ? `${event.operation} ` : ''}error [${event.code}]: ${event.message}`
    case 'stopped':
      return 'Stopped watching.'
  }
}

function emitEvent(argv: WatchArgv, logger: Logger, event: WatchEvent): void {
  if (argv.json) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
    return
  }
  const color = event.type === 'error' ? 'red' : event.type === 'result' ? 'green' : 'cyan'
  logger.log(describeEvent(event), { color })
}

export const handler: CommandHandler<WatchArgv> = async (argv, logger) => {
  const operations: AgentOperation[] = []
  if (argv.review || !argv.draft) operations.push('review')
  if (argv.draft) operations.push('commit-draft')

  const repoRoot = await resolveAgentRepoRoot(argv.repo)
  // Config discovery reads process.cwd() in several places (project config
  // lookup, commitlint discovery) — chdir once up front so every downstream
  // read sees the watched repo, mirroring `coco mcp` / `coco agent`.
  process.chdir(repoRoot)

  const controller = new AbortController()
  const context = await createAgentOperationContext({
    repoRoot,
    signal: controller.signal,
    surface: 'watch',
  })

  const scopeType: 'staged' | 'worktree' = argv.staged ? 'staged' : 'worktree'
  const source: ChangeSource = { kind: 'repository', scope: { type: scopeType } }
  // Unlike the one-shot agent CLI / MCP surface (which default this to
  // false because an external, LLM-driven caller might point it at an
  // untrusted repo), `coco watch` is invoked directly by the user against
  // their own working tree — the same trust level `coco review` already
  // operates at without asking.
  const trustRepositoryConfig = scopeType === 'worktree'

  const options: AgentOptions = {
    language: argv.language,
    conventional: Boolean(argv.conventional),
    includeBranchName: false,
    previousCommitCount: 0,
    author: false,
    trustRepositoryConfig,
  }

  const input = AgentTaskInputSchema.parse({ source, options })

  const debounceMs = argv.debounce ?? 500
  const intervalMs = argv.interval ?? 15000

  // Diff-hash guard (#1955): an fs event doesn't imply the diff actually
  // changed (editors can touch-save unchanged content, or fire twice for
  // one edit). Comparing `resolveChangeSource`'s content digest against the
  // last-seen value skips the LLM call entirely when nothing changed.
  let lastDigest: string | undefined
  let stopped = false

  async function runOnce(): Promise<void> {
    if (stopped) return

    let resolved: ResolvedChangeContext
    try {
      resolved = await resolveChangeSource(source, context, { trustRepositoryConfig })
    } catch (error) {
      const normalized = toAgentOperationError(error)
      if (normalized.code === 'NO_CHANGES') {
        lastDigest = undefined
        emitEvent(argv, logger, { type: 'idle' })
        return
      }
      if (!stopped) {
        emitEvent(argv, logger, { type: 'error', code: normalized.code, message: normalized.message })
      }
      return
    }

    if (resolved.meta.digest === lastDigest) {
      emitEvent(argv, logger, { type: 'skipped', reason: 'unchanged', digest: resolved.meta.digest })
      return
    }
    lastDigest = resolved.meta.digest

    for (const operation of operations) {
      if (stopped) return
      emitEvent(argv, logger, { type: 'running', operation })
      try {
        // Reuse the digest guard's snapshot so both operations in a
        // `--review --draft` pass see the exact tree the digest was taken
        // from, and so a settled change set resolves the diff once.
        const envelope = await runAgentOperation(operation, input, context, resolved)
        emitEvent(argv, logger, { type: 'result', operation, data: envelope.data, warnings: envelope.warnings })
      } catch (error) {
        const normalized = toAgentOperationError(error)
        // Shutdown may abort an in-flight operation; `stopped` already
        // emitted the terminal `stopped` event by the time this rejects, so
        // don't emit a trailing error after it.
        if (!stopped) {
          emitEvent(argv, logger, { type: 'error', operation, code: normalized.code, message: normalized.message })
        }
      }
    }
  }

  emitEvent(argv, logger, { type: 'ready', repoRoot, operations, scope: scopeType })

  if (argv.once) {
    await runOnce()
    emitEvent(argv, logger, { type: 'stopped' })
    return
  }

  const runner = createThrottledRunner(intervalMs, runOnce)
  const gitDir = (await context.git.revparse(['--absolute-git-dir'])).trim()
  const watcher = createRepoChangeWatcher({
    repoRoot,
    gitDir,
    debounceMs,
    onChange: () => runner.trigger(),
  })

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (stopped) return
      stopped = true
      controller.abort()
      watcher.close()
      runner.close()
      process.removeListener('SIGINT', shutdown)
      process.removeListener('SIGTERM', shutdown)
      emitEvent(argv, logger, { type: 'stopped' })
      resolve()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
