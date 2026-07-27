import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GhRunner, defaultGhRunner } from './pullRequestData'
import { runGhAction } from './githubCli'
import { rejectFlagLike, rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'
import { getPullRequestChecks, type PullRequestStatusCheck } from './pullRequestDetailData'

/**
 * Shared result shape for every forge action (gh/glab/Bitbucket, PR/issue
 * verbs alike). `url` is only ever populated by PR/MR-returning actions;
 * issue actions simply never set it.
 */
export type ForgeActionResult = {
  ok: boolean
  message: string
  url?: string
  /** Bounded extra lines from a compacted forge-CLI/API error, when present. */
  details?: string[]
}

/** @deprecated use ForgeActionResult */
export type PullRequestActionResult = ForgeActionResult

export type CreatePullRequestInput = {
  base: string
  head: string
  title: string
  body: string
  draft?: boolean
}

function parseCreatedPullRequestUrl(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('https://'))
}

export function buildCreatePullRequestArgs(
  input: CreatePullRequestInput,
  bodyFile?: string,
): string[] {
  const args = [
    'pr',
    'create',
    `--base=${input.base}`,
    `--head=${input.head}`,
    `--title=${input.title}`,
    bodyFile ? `--body-file=${bodyFile}` : `--body=${input.body}`,
  ]

  if (input.draft) {
    args.push('--draft')
  }

  return args
}

export async function createPullRequest(
  input: CreatePullRequestInput,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return { ok: false, message: bad }
  // The body travels via a temp file, not argv: generated bodies run to
  // multi-KB markdown, and inlining them in `--body=` both flirts with
  // arg-length limits and echoes the whole body back through error
  // messages when gh fails.
  const bodyDir = mkdtempSync(join(tmpdir(), 'coco-pr-'))
  const bodyFile = join(bodyDir, 'body.md')
  try {
    writeFileSync(bodyFile, input.body, 'utf8')
    return await runGhAction(runner, buildCreatePullRequestArgs(input, bodyFile), (output) => {
      const url = parseCreatedPullRequestUrl(output)

      return {
        ok: true,
        message: url ? `Created pull request: ${url}` : 'Created pull request',
        url,
      }
    })
  } finally {
    rmSync(bodyDir, { recursive: true, force: true })
  }
}

export function openPullRequest(url: string, runner: GhRunner = defaultGhRunner): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'view', '--web'], () => ({
    ok: true,
    message: `Opened pull request: ${url}`,
    url,
  }))
}

/**
 * #783 — full PR action panel. The actions below all wrap a single
 * `gh pr <verb>` invocation. Strategy / body / option text travels in
 * via the action input; the runner-error / status surfacing is handled
 * by the shared `runGhAction` wrapper so callers always get a uniform
 * `PullRequestActionResult`.
 */

export type PullRequestMergeStrategy = 'merge' | 'squash' | 'rebase'

export function isPullRequestMergeStrategy(value: string): value is PullRequestMergeStrategy {
  return value === 'merge' || value === 'squash' || value === 'rebase'
}

export function buildMergePullRequestArgs(strategy: PullRequestMergeStrategy): string[] {
  // `--auto` and `--admin` are intentionally omitted — they're rarely
  // what a user wants from a TUI and require explicit gh auth scopes.
  // `--delete-branch` is opt-in via a future flag; default leaves the
  // branch in place so the user can verify before cleanup.
  return ['pr', 'merge', `--${strategy}`]
}

export function mergePullRequest(
  strategy: PullRequestMergeStrategy,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, buildMergePullRequestArgs(strategy), (output) => ({
    ok: true,
    message: output.trim() || `Merged pull request with ${strategy}`,
  }))
}

export function closePullRequest(
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'close'], (output) => ({
    ok: true,
    message: output.trim() || 'Closed pull request',
  }))
}

/**
 * `gh pr review --approve` requires the user's gh auth to have scope
 * to write reviews — same scope that the in-browser approve button
 * uses. The runner surfaces auth failures via the standard error path.
 */
export function approvePullRequest(
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(runner, ['pr', 'review', '--approve'], (output) => ({
    ok: true,
    message: output.trim() || 'Approved pull request',
  }))
}

/**
 * Request changes — `gh pr review` requires a body with this verb so
 * the empty-body case is rejected upstream by the input prompt.
 */
export function requestChangesPullRequest(
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGhAction(runner, ['pr', 'review', '--request-changes', `--body=${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Requested changes',
  }))
}

export function commentPullRequest(
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGhAction(runner, ['pr', 'comment', `--body=${body}`], (output) => ({
    ok: true,
    message: output.trim() || 'Comment added',
  }))
}

/**
 * Triage-view variants (#882 phase 4). Same shape as
 * `commentPullRequest` above but target a specific PR by number,
 * which is what the multi-PR triage list needs (the cursor isn't
 * necessarily on the current branch's PR). Kept as siblings rather
 * than overloads so the single-PR call sites stay untouched and
 * the API stays readable at the call site (no need to pass
 * `undefined` to skip the number arg).
 */
export function commentPullRequestByNumber(
  pullRequestNumber: number,
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGhAction(
    runner,
    ['pr', 'comment', String(pullRequestNumber), `--body=${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on pull request #${pullRequestNumber}`,
    })
  )
}

export function addPullRequestLabel(
  pullRequestNumber: number,
  label: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  const bad = rejectUnsafeLabel(label)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGhAction(
    runner,
    ['pr', 'edit', String(pullRequestNumber), `--add-label=${label}`],
    () => ({
      ok: true,
      message: `Added label '${label}' to pull request #${pullRequestNumber}`,
    })
  )
}

export function addPullRequestAssignee(
  pullRequestNumber: number,
  assignee: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee login required' })
  }
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGhAction(
    runner,
    ['pr', 'edit', String(pullRequestNumber), `--add-assignee=${assignee}`],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to pull request #${pullRequestNumber}`,
    })
  )
}

/**
 * Destructive PR verbs targeting a specific number (#882 phase 5).
 * Siblings of the existing current-branch functions above; both
 * variants delegate to the same `runGhAction` wrapper so error
 * shaping stays uniform.
 */
export function mergePullRequestByNumber(
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(
    runner,
    ['pr', 'merge', String(pullRequestNumber), `--${strategy}`],
    (output) => ({
      ok: true,
      message:
        output.trim() ||
        `Merged pull request #${pullRequestNumber} with ${strategy}`,
    })
  )
}

export function closePullRequestByNumber(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(
    runner,
    ['pr', 'close', String(pullRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Closed pull request #${pullRequestNumber}`,
    })
  )
}

export function approvePullRequestByNumber(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(
    runner,
    ['pr', 'review', String(pullRequestNumber), '--approve'],
    (output) => ({
      ok: true,
      message: output.trim() || `Approved pull request #${pullRequestNumber}`,
    })
  )
}

export function requestChangesPullRequestByNumber(
  pullRequestNumber: number,
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  }
  return runGhAction(
    runner,
    ['pr', 'review', String(pullRequestNumber), '--request-changes', `--body=${body}`],
    (output) => ({
      ok: true,
      message:
        output.trim() ||
        `Requested changes on pull request #${pullRequestNumber}`,
    })
  )
}

/**
 * `gh pr checkout <n>` — fetch the PR's head branch and switch the
 * worktree onto it (#1363). The one triage verb that mutates LOCAL
 * state rather than forge state: no y-confirm (a checkout is cheap to
 * undo and gh refuses rather than clobbering a dirty worktree), but
 * the workstation runs it as a workflow so it gets the row spinner +
 * post-op context refresh like `checkout-branch`.
 */
export function checkoutPullRequestByNumber(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(
    runner,
    ['pr', 'checkout', String(pullRequestNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Checked out pull request #${pullRequestNumber}`,
    })
  )
}

/**
 * CI-checks surface (OSS-1615) — "one flaky check failed, re-run it,
 * then merge" without a browser trip. gh's `statusCheckRollup` collapses
 * every check into `{name, status, conclusion}` with no re-run handle of
 * its own, so this re-derives the workflow run id from each failed
 * check's `detailsUrl` (parsed into `runId` by `getPullRequestChecks`)
 * and reruns each DISTINCT run's failed jobs — a single workflow run
 * commonly backs several check-rollup rows (one per job), so re-running
 * the same run id twice would be redundant, hence the de-dupe.
 */
function isFailedCheck(check: PullRequestStatusCheck): boolean {
  const conclusion = (check.conclusion || '').toUpperCase()
  // ACTION_REQUIRED means the run is awaiting manual approval (a deployment
  // gate or first-time-contributor check) — not a failed job, so
  // `gh run rerun --failed` can't advance it.
  return conclusion === 'FAILURE' || conclusion === 'ERROR' || conclusion === 'TIMED_OUT'
}

export async function rerunFailedChecks(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  const checksResult = await getPullRequestChecks(pullRequestNumber, runner)
  if (!checksResult.ok) {
    return { ok: false, message: checksResult.message }
  }

  const failedRunIds = [...new Set(
    checksResult.checks.filter(isFailedCheck).map((check) => check.runId).filter((id): id is string => Boolean(id))
  )]

  if (!failedRunIds.length) {
    return {
      ok: false,
      message: `No re-runnable failed checks found for pull request #${pullRequestNumber}.`,
    }
  }

  const results = await Promise.all(
    failedRunIds.map((runId) =>
      runGhAction(runner, ['run', 'rerun', runId, '--failed'], (output) => ({
        ok: true,
        message: output.trim() || `Re-ran failed jobs for workflow run ${runId}`,
      }))
    )
  )

  const failures = results.filter((result) => !result.ok)
  if (failures.length) {
    return {
      ok: false,
      message: `Re-ran ${results.length - failures.length}/${results.length} workflow run(s) for pull request #${pullRequestNumber}; ${failures.length} failed.`,
      details: failures.flatMap((failure) => (failure.details?.length ? failure.details : [failure.message])),
    }
  }

  return {
    ok: true,
    message: `Re-ran ${failedRunIds.length} failed workflow run${failedRunIds.length === 1 ? '' : 's'} for pull request #${pullRequestNumber}.`,
  }
}

/**
 * `gh pr merge --auto` — merges automatically once required checks pass
 * (and branch protection allows it; gh surfaces the "not allowed"
 * rejection through the standard error path if the repo hasn't enabled
 * auto-merge).
 */
export function enableAutoMerge(
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  return runGhAction(
    runner,
    ['pr', 'merge', String(pullRequestNumber), '--auto', `--${strategy}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Enabled auto-merge (${strategy}) for pull request #${pullRequestNumber}`,
    })
  )
}
