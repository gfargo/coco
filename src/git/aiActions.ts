import { Arguments } from 'yargs'
import { generateChangelogResult } from '../commands/changelog/handler'
import { ChangelogOptions } from '../commands/changelog/config'
import { runCommitWorkflow } from './commitWorkflowActions'
import { HistoryCommitRef } from './historyActions'
import { TagRangeSummary } from './tagData'
import { LangChainCancelledError } from '../lib/langchain/errors'
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
    const { text } = await generateChangelogResult(argv, new Logger({ silent: true }))
    const formatted = formatCapturedAiOutput(text)

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

  let text = ''
  try {
    const result = await generateChangelogResult(argv, new Logger({ silent: true }))
    text = result.text.trim()
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }

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

/**
 * Run `coco changelog` and return the raw captured stdout, intact —
 * blank lines preserved, no telemetry stripping. Use this when you
 * want to show or copy the changelog as the user would see it from
 * the CLI (the chromed-up `runChangelogAction` collapses blank lines
 * via `compactOutputLines` which is wrong for any UI that wants the
 * full prose output).
 *
 * The argv defaults match `createChangelogArgv` — pass overrides via
 * `input`. Common shapes:
 *
 *   - { branch: 'main' }           — commits on current branch vs main
 *   - { sinceLastTag: true }       — since last tag
 *   - { tag: 'v1.0.0' }            — since a specific tag
 *   - { range: 'abc..def' }        — between two refs
 *
 * Returns:
 *   - { ok: true, message, text } on success (message = first non-blank
 *     line, useful for status surface; text = full raw output)
 *   - { ok: false, message } on changelog handler error or empty output
 */
export async function runChangelogTextWorkflow(
  input: Partial<ChangelogOptions> = {},
  options: { signal?: AbortSignal } = {}
): Promise<{ ok: boolean; message: string; text?: string; cancelled?: boolean }> {
  const argv = createChangelogArgv(input)

  let text = ''
  try {
    const result = await generateChangelogResult(argv, new Logger({ silent: true }), {
      signal: options.signal,
    })
    text = result.text.trim()
  } catch (error) {
    // User cancellation (#1338) is intent, not failure — flag it so the
    // caller can show a neutral "cancelled" status instead of an error.
    if (error instanceof LangChainCancelledError) {
      return { ok: false, cancelled: true, message: 'Changelog generation cancelled.' }
    }
    return { ok: false, message: (error as Error).message }
  }

  if (!text) {
    return {
      ok: false,
      message: 'No changelog output produced — branch may have no commits ahead of base.',
    }
  }

  const firstLine = text.split('\n').find((line) => line.trim()) || 'Changelog generated.'
  return { ok: true, message: firstLine, text }
}

export const aiActionTestInternals = {
  compactOutputLines,
  createChangelogArgv,
  estimateTextTokens,
  formatCapturedAiOutput,
}
