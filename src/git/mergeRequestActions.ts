import { defaultGlabRunner, resolveGlabActionError, type GlabRunner } from './glabCli'
import type { PullRequestActionResult } from './pullRequestActions'

/**
 * GitLab merge-request create/open, the glab counterparts to the gh
 * `createPullRequest` / `openPullRequest` used by `coco pr create`. They return
 * the same `PullRequestActionResult` so the command handler treats both forges
 * uniformly. (The broader MR/issue mutating-action set lands with the
 * workstation TUI integration in a follow-up.)
 */

export type CreateMergeRequestInput = {
  base: string
  head: string
  title: string
  body: string
  draft?: boolean
}

function parseCreatedMergeRequestUrl(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('https://'))
}

async function runGlabAction(
  runner: GlabRunner,
  args: string[],
  onSuccess: (output: string) => PullRequestActionResult
): Promise<PullRequestActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

export function buildCreateMergeRequestArgs(input: CreateMergeRequestInput): string[] {
  // `--yes` skips glab's interactive confirmation; supplying title + description
  // keeps it non-interactive (no editor). `--draft` marks it a draft MR.
  const args = [
    'mr',
    'create',
    '--source-branch',
    input.head,
    '--target-branch',
    input.base,
    '--title',
    input.title,
    '--description',
    input.body,
    '--yes',
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export function createMergeRequest(
  input: CreateMergeRequestInput,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, buildCreateMergeRequestArgs(input), (output) => {
    const url = parseCreatedMergeRequestUrl(output)
    return {
      ok: true,
      message: url ? `Created merge request: ${url}` : 'Created merge request',
      url,
    }
  })
}

export function openMergeRequest(
  url: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened merge request: ${url}`,
    url,
  }))
}

/**
 * Mutating MR actions, the glab counterparts to `pullRequestActions.ts`. glab
 * infers the project from the repo remote and the MR from the IID (or the
 * current branch for the no-IID variants). The verb/flag choices below follow
 * the glab CLI; they are contract-locked by the arg-builder tests and should be
 * smoke-tested against a live GitLab instance before relying on them.
 *
 * Strategy maps to glab's merge flags: plain merge (no flag), `--squash`,
 * `--rebase`. `--yes` skips glab's interactive confirm.
 */
export type MergeRequestMergeStrategy = 'merge' | 'squash' | 'rebase'

function mergeStrategyFlags(strategy: MergeRequestMergeStrategy): string[] {
  if (strategy === 'squash') return ['--squash']
  if (strategy === 'rebase') return ['--rebase']
  return []
}

export function mergeMergeRequestByNumber(
  mergeRequestNumber: number,
  strategy: MergeRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'merge', String(mergeRequestNumber), ...mergeStrategyFlags(strategy), '--yes'],
    (output) => ({
      ok: true,
      message: output.trim() || `Merged merge request !${mergeRequestNumber} with ${strategy}`,
    })
  )
}

export function approveMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'approve', String(mergeRequestNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Approved merge request !${mergeRequestNumber}`,
  }))
}

export function closeMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'close', String(mergeRequestNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Closed merge request !${mergeRequestNumber}`,
  }))
}

export function commentMergeRequestByNumber(
  mergeRequestNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', String(mergeRequestNumber), '--message', body],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on merge request !${mergeRequestNumber}`,
    })
  )
}

/**
 * GitLab has no native "request changes" review verb (it uses approvals plus
 * discussion). The closest faithful behavior is a note carrying the reviewer's
 * body, prefixed so intent is clear. Documented as a limitation.
 */
export function requestChangesMergeRequestByNumber(
  mergeRequestNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', String(mergeRequestNumber), '--message', `Requested changes: ${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Requested changes on merge request !${mergeRequestNumber}`,
    })
  )
}

export function addMergeRequestLabel(
  mergeRequestNumber: number,
  label: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  return runGlabAction(
    runner,
    ['mr', 'update', String(mergeRequestNumber), '--label', label],
    () => ({
      ok: true,
      message: `Added label '${label}' to merge request !${mergeRequestNumber}`,
    })
  )
}

export function addMergeRequestAssignee(
  mergeRequestNumber: number,
  assignee: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee username required' })
  }
  return runGlabAction(
    runner,
    ['mr', 'update', String(mergeRequestNumber), '--assignee', assignee],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to merge request !${mergeRequestNumber}`,
    })
  )
}

// Current-branch variants (no IID — glab infers the MR from the checked-out
// source branch), mirroring the gh current-branch PR actions.

export function mergeMergeRequest(
  strategy: MergeRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'merge', ...mergeStrategyFlags(strategy), '--yes'], (output) => ({
    ok: true,
    message: output.trim() || `Merged merge request with ${strategy}`,
  }))
}

export function closeMergeRequest(
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'close'], (output) => ({
    ok: true,
    message: output.trim() || 'Closed merge request',
  }))
}

export function approveMergeRequest(
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'approve'], (output) => ({
    ok: true,
    message: output.trim() || 'Approved merge request',
  }))
}

export function commentMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(runner, ['mr', 'note', '--message', body], (output) => ({
    ok: true,
    message: output.trim() || 'Comment added',
  }))
}

export function requestChangesMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(runner, ['mr', 'note', '--message', `Requested changes: ${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Requested changes',
  }))
}
