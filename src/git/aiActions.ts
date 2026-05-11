import { Arguments } from 'yargs'
import { handler as changelogHandler } from '../commands/changelog/handler'
import { ChangelogOptions } from '../commands/changelog/config'
import { runCommitWorkflow } from './commitWorkflowActions'
import { HistoryCommitRef } from './historyActions'
import { TagRangeSummary } from './tagData'
import { Logger } from '../lib/utils/logger'

export type LogAiAction =
  | 'summarize-commit'
  | 'summarize-range'
  | 'release-notes'
  | 'split-plan'
  | 'risk-review'

export type LogAiActionContext = {
  selectedCommit?: HistoryCommitRef
  compareBase?: HistoryCommitRef
  selectedTag?: string
  tagRangeSummary?: TagRangeSummary
  defaultBranch?: string
}

export type LogAiActionImpact = {
  action: LogAiAction
  label: string
  estimatedTokens: number
  large: boolean
  requiresConfirmation: boolean
}

export type LogAiActionResult = {
  ok: boolean
  message: string
  details?: string[]
  editable?: string
}

type ChangelogWorkflowArgv = Arguments<ChangelogOptions> & {
  mode: 'stdout'
}

const LARGE_AI_ACTION_TOKEN_THRESHOLD = 4000

function estimateTextTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

export function estimateLogAiActionImpact(
  action: LogAiAction,
  context: LogAiActionContext
): LogAiActionImpact {
  const contextText = [
    context.selectedCommit?.hash,
    context.selectedCommit?.message,
    context.compareBase?.hash,
    context.compareBase?.message,
    context.selectedTag,
    context.tagRangeSummary
      ? `${context.tagRangeSummary.commitCount} commits ${context.tagRangeSummary.changedFiles.length} files`
      : undefined,
  ].filter(Boolean).join('\n')
  const estimatedTokens = Math.max(64, estimateTextTokens(contextText) + 256)

  return {
    action,
    label: action.replace(/-/g, ' '),
    estimatedTokens,
    large: estimatedTokens >= LARGE_AI_ACTION_TOKEN_THRESHOLD,
    requiresConfirmation: true,
  }
}

function createChangelogArgv(input: Partial<ChangelogOptions>): ChangelogWorkflowArgv {
  return {
    $0: 'coco',
    _: ['changelog'],
    interactive: false,
    verbose: true,
    version: false,
    help: false,
    mode: 'stdout',
    range: '',
    branch: '',
    tag: '',
    sinceLastTag: false,
    withDiff: false,
    onlyDiff: false,
    author: false,
    ...input,
  } as ChangelogWorkflowArgv
}

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout)
  let output = ''

  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString()

    const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === 'function')
    callback?.()

    return true
  }) as typeof process.stdout.write

  try {
    await action()
    return output
  } finally {
    process.stdout.write = originalWrite
  }
}

function formatCapturedAiOutput(output: string): Pick<LogAiActionResult, 'message' | 'details' | 'editable'> {
  const lines = compactOutputLines(output)
  const telemetry = lines.filter((line) => line.includes('[llm:summary]'))
  const content = lines.filter((line) => !line.includes('[llm]') && !line.includes('[llm:summary]'))
  const editable = content.join('\n')

  return {
    message: content[0] || telemetry[0] || 'AI action completed.',
    details: telemetry.slice(0, 3),
    editable,
  }
}

async function runChangelogAction(argv: ChangelogWorkflowArgv): Promise<LogAiActionResult> {
  try {
    const output = await captureStdout(() => changelogHandler(argv, new Logger({
      verbose: true,
      silent: false,
    })))
    const formatted = formatCapturedAiOutput(output)

    return {
      ok: true,
      ...formatted,
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

export async function runLogAiAction(
  action: LogAiAction,
  context: LogAiActionContext
): Promise<LogAiActionResult> {
  if (action === 'split-plan') {
    return runCommitWorkflow({
      action: 'split-plan',
    })
  }

  if (action === 'risk-review') {
    return runCommitWorkflow({
      action: 'split-plan',
    }).then((result) => ({
      ...result,
      message: result.ok ? 'Risk review prepared from commit split analysis.' : result.message,
    }))
  }

  if (action === 'release-notes') {
    const tag = context.selectedTag || context.tagRangeSummary?.from

    if (!tag) {
      return {
        ok: false,
        message: 'Select a tag before generating release notes.',
      }
    }

    return runChangelogAction(createChangelogArgv({
      tag,
      author: true,
    }))
  }

  if (action === 'summarize-range') {
    const from = context.compareBase?.hash
    const to = context.selectedCommit?.hash

    if (!from || !to) {
      return {
        ok: false,
        message: 'Select a compare base before summarizing a range.',
      }
    }

    return runChangelogAction(createChangelogArgv({
      range: `${from}:${to}`,
    }))
  }

  if (!context.selectedCommit) {
    return {
      ok: false,
      message: 'No commit selected for AI summary.',
    }
  }

  return runChangelogAction(createChangelogArgv({
    range: `${context.selectedCommit.hash}^:${context.selectedCommit.hash}`,
  }))
}

/**
 * Generate a pull-request body for the current branch by running
 * `coco changelog --branch <base>` and parsing the title / content
 * out of the captured stdout.
 *
 * The changelog handler emits `${title}\n\n${content}[\n\nPart of <ticket>]`
 * (see `commands/changelog/handler.ts` line 306). We split on the first
 * blank-line boundary so the caller gets a clean title + body pair to
 * pre-fill the PR creation prompt with. Ticket footer (when present)
 * stays in the body so the resulting PR keeps the reference.
 *
 * Captures the raw stdout (rather than going through `runChangelogAction`,
 * which strips blank lines via its `compactOutputLines` filter) so the
 * title-vs-body separator survives intact.
 *
 * Returns the standard LogAiActionResult plus extracted `title` / `body`
 * fields. Falls back to undefined `title` / `body` when the changelog
 * fails or produces no parseable output; the caller is expected to
 * surface that as a prompt with empty fields rather than aborting.
 */
export async function runPullRequestBodyWorkflow(
  input: { baseBranch?: string } = {}
): Promise<LogAiActionResult & { title?: string; body?: string }> {
  const baseBranch = input.baseBranch || 'main'
  const argv = createChangelogArgv({ branch: baseBranch })

  let raw = ''
  try {
    raw = await captureStdout(() => changelogHandler(argv, new Logger({
      verbose: true,
      silent: false,
    })))
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }

  const text = raw.trim()
  if (!text) {
    return {
      ok: false,
      message: 'No changelog output produced — branch may have no commits ahead of base.',
    }
  }

  // First blank-line boundary separates title from body. Falls back to
  // "everything is the title" when no blank line is found — typical of
  // very small changesets where the changelog content collapsed to one
  // line.
  const blankIdx = text.indexOf('\n\n')
  const title = blankIdx > 0 ? text.slice(0, blankIdx).trim() : text.split('\n')[0].trim()
  const body = blankIdx > 0 ? text.slice(blankIdx + 2).trim() : ''

  // Keep the standard LogAiActionResult shape (message + telemetry
  // details + editable text) so palette callers get a consistent
  // surface. The captured telemetry lines are dropped here — the PR
  // body should be the actionable content, not the LLM trace.
  return {
    ok: true,
    message: title || 'Pull request body drafted.',
    details: [],
    editable: text,
    title,
    body,
  }
}

export const aiActionTestInternals = {
  compactOutputLines,
  createChangelogArgv,
  estimateTextTokens,
  formatCapturedAiOutput,
}
