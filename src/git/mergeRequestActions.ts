import { defaultGlabRunner, resolveGlabActionError, type GlabRunner } from './glabCli'
import { rejectFlagLike, rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'
import type { PullRequestActionResult } from './pullRequestActions'
import { parsePullRequestDiffLines, type PullRequestDiffResult } from './pullRequestDiffData'

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
  onSuccess: (output: string) => PullRequestActionResult,
  hostname?: string
): Promise<PullRequestActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

export function buildCreateMergeRequestArgs(input: CreateMergeRequestInput): string[] {
  // `--yes` skips glab's interactive confirmation; supplying title + description
  // keeps it non-interactive (no editor). `--draft` marks it a draft MR.
  const args = [
    'mr',
    'create',
    `--source-branch=${input.head}`,
    `--target-branch=${input.base}`,
    `--title=${input.title}`,
    `--description=${input.body}`,
    // Push the (committed) source branch as part of creation so the MR can be
    // opened even when the branch isn't on the remote yet — mirrors how the
    // GitHub flow expects a pushed branch.
    '--push',
    '--yes',
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export function createMergeRequest(
  input: CreateMergeRequestInput,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(runner, buildCreateMergeRequestArgs(input), (output) => {
    const url = parseCreatedMergeRequestUrl(output)
    return {
      ok: true,
      message: url ? `Created merge request: ${url}` : 'Created merge request',
      url,
    }
  }, hostname)
}

export function openMergeRequest(
  url: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened merge request: ${url}`,
    url,
  }), hostname)
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
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'merge', String(mergeRequestNumber), ...mergeStrategyFlags(strategy), '--yes'],
    (output) => ({
      ok: true,
      message: output.trim() || `Merged merge request !${mergeRequestNumber} with ${strategy}`,
    }),
    hostname
  )
}

export function approveMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'approve', String(mergeRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Approved merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function closeMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(
    runner,
    ['mr', 'close', String(mergeRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Closed merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function commentMergeRequestByNumber(
  mergeRequestNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', 'create', String(mergeRequestNumber), `--message=${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on merge request !${mergeRequestNumber}`,
    }),
    hostname
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
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(
    runner,
    ['mr', 'note', 'create', String(mergeRequestNumber), `--message=Requested changes: ${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Requested changes on merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function addMergeRequestLabel(
  mergeRequestNumber: number,
  label: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  const bad = rejectUnsafeLabel(label)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    ['mr', 'update', String(mergeRequestNumber), `--label=${label}`],
    () => ({
      ok: true,
      message: `Added label '${label}' to merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

export function addMergeRequestAssignee(
  mergeRequestNumber: number,
  assignee: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee username required' })
  }
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    // `+` prefix ADDS to existing assignees; a bare username would replace them.
    ['mr', 'update', String(mergeRequestNumber), `--assignee=+${assignee}`],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to merge request !${mergeRequestNumber}`,
    }),
    hostname
  )
}

// Current-branch variants (no IID — glab infers the MR from the checked-out
// source branch), mirroring the gh current-branch PR actions.

export function mergeMergeRequest(
  strategy: MergeRequestMergeStrategy,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'merge', ...mergeStrategyFlags(strategy), '--yes'], (output) => ({
    ok: true,
    message: output.trim() || `Merged merge request with ${strategy}`,
  }), hostname)
}

export function closeMergeRequest(
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'close'], (output) => ({
    ok: true,
    message: output.trim() || 'Closed merge request',
  }), hostname)
}

export function approveMergeRequest(
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'approve'], (output) => ({
    ok: true,
    message: output.trim() || 'Approved merge request',
  }), hostname)
}

export function commentMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(runner, ['mr', 'note', 'create', `--message=${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Comment added',
  }), hostname)
}

export function requestChangesMergeRequest(
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGlabAction(runner, ['mr', 'note', 'create', `--message=Requested changes: ${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Requested changes',
  }), hostname)
}

/**
 * `glab mr checkout <n>` — the GitLab counterpart of
 * `checkoutPullRequestByNumber` (#1363). Fetches the MR's source
 * branch and switches the worktree onto it.
 */
export function checkoutMergeRequestByNumber(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestActionResult> {
  return runGlabAction(runner, ['mr', 'checkout', String(mergeRequestNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Checked out merge request !${mergeRequestNumber}`,
  }), hostname)
}

/**
 * `glab mr diff <n>` argv (#1363). `--color=never` keeps the patch free
 * of ANSI escapes regardless of glab's TTY detection — the workstation
 * applies its own +/- theming per line.
 */
export function buildMergeRequestDiffArgs(mergeRequestNumber: number): string[] {
  return ['mr', 'diff', String(mergeRequestNumber), '--color=never']
}

/**
 * Unified-patch fetch for a merge request by number — the GitLab
 * counterpart of `getPullRequestDiff` (#1363). Returns the shared
 * `PullRequestDiffResult` so the workstation's PR-diff hydration
 * treats both forges uniformly.
 */
export async function getMergeRequestDiff(
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<PullRequestDiffResult> {
  try {
    const output = await runner(buildMergeRequestDiffArgs(mergeRequestNumber))
    return { ok: true, lines: parsePullRequestDiffLines(output) }
  } catch (error) {
    const { message } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message }
  }
}
