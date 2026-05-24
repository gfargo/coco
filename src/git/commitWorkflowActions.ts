import { Arguments } from 'yargs'
import { type TiktokenModel } from '@langchain/openai'
import { SimpleGit } from 'simple-git'
import { handler as commitHandler } from '../commands/commit/handler'
import { CommitOptions } from '../commands/commit/config'
import { generateCommitDraft } from '../commands/commit/generateCommitDraft'
import {
  CommitSplitPlan,
  CommitSplitPlanContext,
  applyCommitSplitPlan,
  prepareCommitSplitPlan,
} from '../commands/commit/split'
import { LLMModel } from '../lib/langchain/types'
import {
  getApiKeyForModel,
  getModelAndProviderFromConfig,
} from '../lib/langchain/utils'
import { resolveDynamicService } from '../lib/langchain/utils/dynamicModels'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { createCommit, PreCommitHookError } from '../lib/simple-git/createCommit'
import { getRepo } from '../lib/simple-git/getRepo'
import { isCommandExitError } from '../lib/utils/commandExit'
import { Logger } from '../lib/utils/logger'
import { getTokenCounter } from '../lib/utils/tokenizer'

export type CommitWorkflowAction = 'commit' | 'split-plan' | 'split-apply'

export type CommitWorkflowResult = {
  ok: boolean
  message: string
  details?: string[]
  draft?: string
  /**
   * Set when the underlying LLM call was cancelled via an
   * `AbortSignal` (#881 phase 3). Callers should treat this as user
   * intent, not failure: no error styling on the status line, no
   * retry. The `message` field already reads as a cancel
   * confirmation when this is set.
   */
  cancelled?: boolean
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
  input: {
    git?: SimpleGit
    /**
     * Optional streaming callback (#881 phase 2). Forwarded straight
     * through to `generateCommitDraft`; only fires when the user's
     * `service.streaming.enabled` is also true. The TUI passes a
     * dispatcher that updates `commitCompose.streamingPreview` so the
     * compose surface can render a live preview while the LLM
     * generates. Output contract (the returned `draft` /
     * `message` / `details`) is unchanged from the non-streaming path.
     */
    onStreamChunk?: (text: string, accumulated: string) => void
    /**
     * Optional `AbortSignal` for cancel (#881 phase 3). Forwarded
     * through to `generateCommitDraft`. When the signal fires
     * mid-stream the returned result has `cancelled: true` and the
     * caller should clean up without surfacing an error.
     */
    signal?: AbortSignal
  } = {}
): Promise<CommitWorkflowResult> {
  const git = input.git || getRepo()
  const argv = createCommitWorkflowArgv('commit')
  const logger = new Logger({ silent: true })

  try {
    const result = await generateCommitDraft({
      git,
      argv,
      logger,
      onStreamChunk: input.onStreamChunk,
      signal: input.signal,
    })
    const draft = result.draft.trim()

    // Cancel path (#881 phase 3). Reported separately from success
    // / failure so the runtime can render a neutral "cancelled"
    // status line instead of an error.
    if (result.cancelled) {
      return {
        ok: false,
        message: 'AI draft cancelled.',
        details: [],
        draft: '',
        cancelled: true,
      }
    }

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

/**
 * Result shape for the workstation-side split-plan workflow. Distinct
 * from `CommitWorkflowResult` because the workstation needs the
 * structured plan + context (not just a string message) so the
 * overlay can render groups one-by-one AND pass the same plan to
 * apply without re-rolling the LLM.
 *
 * `planContext` carries the staged-state snapshot the apply phase
 * needs (`changes` + `hunkInventory`). The workstation holds it in
 * state between plan generation and apply.
 */
export type CommitSplitPlanResult =
  | {
      ok: true
      plan: CommitSplitPlan
      planContext: CommitSplitPlanContext
      /**
       * Set when the planner returned the single-group fallback after
       * exhausting its retry budget. Workstation surfaces should
       * prefix the apply / preview message with a note so the user
       * knows the plan isn't a real LLM split.
       */
      fallback?: import('../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
    }
  | { ok: false; message: string; details?: string[] }

/**
 * Run plan generation in isolation — no formatting, no apply, no
 * stdout side effects. Returns the structured plan + the staged-state
 * context the apply phase needs. The workstation's `S` keystroke
 * calls this; the overlay renders the result; `y`/Enter passes the
 * plan straight to `runCommitSplitApplyWorkflow` so the executed
 * split matches what the user previewed.
 */
export async function runCommitSplitPlanWorkflow(
  input: { git?: SimpleGit } = {}
): Promise<CommitSplitPlanResult> {
  const git = input.git || getRepo()
  const argv = createCommitWorkflowArgv('split-plan')
  const logger = new Logger({ silent: true })
  const config = loadConfig<CommitOptions, CommitWorkflowArgv>(argv)

  // Mirror the LLM / tokenizer setup from commit/handler.ts so plan
  // generation runs against the same provider config as `coco commit
  // --split --plan` would from the CLI. No fallback if the auth check
  // fails — surface it as a workflow error instead.
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const commitService = resolveDynamicService(config, 'commit')
  const splitService = resolveDynamicService(config, 'commitSplit')
  const model = commitService.model

  if (config.service.authentication.type !== 'None' && !key) {
    return {
      ok: false,
      message: 'No API key configured. Set one via env or .coco.config.json before running split.',
    }
  }

  try {
    const tokenizer = await getTokenCounter(
      provider === 'openai' ? (model as TiktokenModel) : 'gpt-4o'
    )
    const llm = getLlm(provider, model as LLMModel, { ...config, service: commitService })
    const planLlm = getLlm(provider, splitService.model as LLMModel, {
      ...config,
      service: splitService,
    })

    const result = await prepareCommitSplitPlan({
      argv,
      config,
      git,
      logger,
      tokenizer,
      llm,
      planLlm,
      planService: splitService,
    })

    if ('empty' in result) {
      return {
        ok: false,
        message: 'No staged changes to split. Stage some files first.',
      }
    }

    return {
      ok: true,
      plan: result.plan,
      planContext: result.context,
      fallback: result.fallback,
    }
  } catch (error) {
    if (isCommandExitError(error)) {
      const lines = compactOutputLines(error.message)
      return {
        ok: false,
        message: lines[0] || 'Split plan generation failed.',
        details: lines.slice(1, 6),
      }
    }
    // formatCommitFailure returns the broader CommitWorkflowResult shape
    // (ok: boolean). Narrow it here — by construction the catch path only
    // ever produces failures, so we know `ok` will be false.
    const failure = formatCommitFailure(error)
    return {
      ok: false,
      message: failure.message,
      details: failure.details,
    }
  }
}

/**
 * Apply a pre-generated split plan. Takes the plan + context that
 * `runCommitSplitPlanWorkflow` produced (held in workstation state
 * during the preview phase) and runs the underlying
 * `applyCommitSplitPlan` — same code path as `coco commit --split
 * --apply` would take through the CLI, just skipping the plan
 * regeneration since the workstation already has the plan to apply.
 *
 * No LLM call here — pure git-index mutation. Each plan group becomes
 * a single commit, in order.
 */
export async function runCommitSplitApplyWorkflow(input: {
  plan: CommitSplitPlan
  planContext: CommitSplitPlanContext
  git?: SimpleGit
  noVerify?: boolean
  /**
   * Optional fallback descriptor carried over from
   * `runCommitSplitPlanWorkflow`. When present, the apply-time
   * success message gets prefixed with a note so the user knows
   * the single-commit fallback is what landed.
   */
  fallback?: import('../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
}): Promise<CommitWorkflowResult & {
  commitHashes?: string[]
  fallback?: import('../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
}> {
  const git = input.git || getRepo()
  const logger = new Logger({ silent: true })

  try {
    const applied = await applyCommitSplitPlan({
      plan: input.plan,
      changes: input.planContext.changes,
      hunkInventory: input.planContext.hunkInventory,
      git,
      logger,
      noVerify: input.noVerify || false,
      fallback: input.fallback,
    })
    return {
      ok: true,
      message: applied.message || 'Applied commit split plan.',
      // Pass the actually-created commit hashes through. The runtime
      // uses them for the just-landed marker; previously it had to do
      // a post-apply `git rev-list` round-trip which was both extra
      // I/O AND inaccurate when partial-apply landed fewer commits
      // than the plan had groups.
      commitHashes: applied.commitHashes,
      fallback: applied.fallback,
    }
  } catch (error) {
    if (isCommandExitError(error)) {
      const lines = compactOutputLines(error.message)
      return {
        ok: error.code === 0,
        message: lines[0] || error.message,
        details: lines.slice(1, 6),
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
