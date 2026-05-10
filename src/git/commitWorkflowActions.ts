import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler as commitHandler } from '../commands/commit/handler'
import { CommitOptions } from '../commands/commit/config'
import { generateCommitDraft } from '../commands/commit/generateCommitDraft'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { createCommit, PreCommitHookError } from '../lib/simple-git/createCommit'
import { getRepo } from '../lib/simple-git/getRepo'
import { isCommandExitError } from '../lib/utils/commandExit'
import { Logger } from '../lib/utils/logger'

export type CommitWorkflowAction = 'commit' | 'split-plan' | 'split-apply'

export type CommitWorkflowResult = {
  ok: boolean
  message: string
  details?: string[]
  draft?: string
}

type CommitWorkflowInput = {
  action: CommitWorkflowAction
  git?: SimpleGit
  noVerify?: boolean
}

type CommitWorkflowArgv = Arguments<CommitOptions> & {
  mode: 'stdout'
  noDiff: boolean
  additional?: string
  append?: string
  appendTicket?: boolean
}

function createCommitWorkflowArgv(action: CommitWorkflowAction): CommitWorkflowArgv {
  const split = action === 'split-plan' || action === 'split-apply'
  const apply = action === 'split-apply'
  const plan = action === 'split-plan'

  return {
    $0: 'coco',
    _: split ? ['commit', 'split'] : ['commit'],
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    mode: 'stdout',
    openInEditor: false,
    ignoredFiles: [],
    ignoredExtensions: [],
    withPreviousCommits: 0,
    conventional: false,
    includeBranchName: true,
    noVerify: false,
    noDiff: false,
    split,
    plan,
    apply,
  } as CommitWorkflowArgv
}

function formatCommitWorkflowMessage(action: CommitWorkflowAction, output: string): string {
  const normalized = output.trim()

  if (normalized) {
    return normalized.split('\n')[0]
  }

  if (action === 'split-plan') {
    return 'Generated commit split plan.'
  }

  if (action === 'split-apply') {
    return 'Applied commit split plan.'
  }

  return 'Generated commit message.'
}

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function formatCommitFailure(error: unknown): CommitWorkflowResult {
  if (error instanceof PreCommitHookError) {
    const details = compactOutputLines(error.hookOutput)

    return {
      ok: false,
      message: `Commit blocked by hook: ${details[0] || 'hook failed'}`,
      details: details.slice(1, 6),
    }
  }

  const details = compactOutputLines((error as Error).message)

  return {
    ok: false,
    message: details[0] || 'Commit action failed.',
    details: details.slice(1, 6),
  }
}

export async function runCommitWorkflow({
  action,
  git = getRepo(),
  noVerify = false,
}: CommitWorkflowInput): Promise<CommitWorkflowResult> {
  const argv = createCommitWorkflowArgv(action)
  argv.noVerify = noVerify
  const logger = new Logger({ silent: true })
  const config = loadConfig<CommitOptions, CommitWorkflowArgv>(argv)
  const originalWrite = process.stdout.write.bind(process.stdout)
  let output = ''

  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString()

    const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === 'function')
    callback?.()

    return true
  }) as typeof process.stdout.write

  try {
    await commitHandler(argv, logger)
    const message = output.trim()

    if (action === 'commit' && message) {
      await createCommit(message, git, undefined, { noVerify: config.noVerify || false })
    }

    return {
      ok: true,
      message: formatCommitWorkflowMessage(action, output),
    }
  } catch (error) {
    if (isCommandExitError(error)) {
      const lines = compactOutputLines(output || error.message)

      return {
        ok: error.code === 0,
        message: lines[0] || error.message,
        details: lines.slice(1, 6),
      }
    }

    return formatCommitFailure(error)
  } finally {
    process.stdout.write = originalWrite
  }
}

export async function runCommitDraftWorkflow(
  input: { git?: SimpleGit } = {}
): Promise<CommitWorkflowResult> {
  const git = input.git || getRepo()
  const argv = createCommitWorkflowArgv('commit')
  const logger = new Logger({ silent: true })

  try {
    const result = await generateCommitDraft({ git, argv, logger })
    const draft = result.draft.trim()

    if (result.ok && draft) {
      return {
        ok: true,
        message: formatCommitWorkflowMessage('commit', draft),
        details: result.warnings,
        draft,
      }
    }

    const failureLines = [
      ...(result.validationErrors || []),
      ...(result.warnings || []),
    ]

    return {
      ok: false,
      message: failureLines[0] ||
        (draft ? 'AI draft did not pass commitlint.' : 'AI draft was empty.'),
      details: failureLines.slice(1, 6),
      draft,
    }
  } catch (error) {
    if (isCommandExitError(error)) {
      const lines = compactOutputLines(error.message)

      return {
        ok: error.code === 0,
        message: lines[0] || error.message,
        details: lines.slice(1, 6),
        draft: '',
      }
    }

    return formatCommitFailure(error)
  }
}

export const commitWorkflowTestInternals = {
  compactOutputLines,
  createCommitWorkflowArgv,
  formatCommitFailure,
  formatCommitWorkflowMessage,
}
