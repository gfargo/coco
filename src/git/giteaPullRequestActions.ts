import { runGiteaAction, type GiteaRunner } from './giteaCli'
import { findOpenGiteaPullRequestForBranch } from './giteaListData'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import type { CreatePullRequestInput, PullRequestActionResult, PullRequestMergeStrategy } from './pullRequestActions'

/**
 * Gitea/Forgejo pull-request mutations via the REST API v1. Each action maps
 * to a Gitea endpoint; `runner` is a host-bound `GiteaRunner` the forge
 * adapter constructs from the detected repository's host (there is no
 * fixed-base default the way Bitbucket has `defaultBitbucketRunner`). Returns
 * the same `PullRequestActionResult` shape as the other forges so the forge
 * adapter dispatches uniformly.
 *
 * Merge strategies: Gitea's `Do` field accepts `merge`, `squash`, `rebase`
 * (and a couple of Gitea-only options coco doesn't expose).
 */

function giteaMergeStrategy(strategy: PullRequestMergeStrategy): string {
  if (strategy === 'squash') return 'squash'
  if (strategy === 'rebase') return 'rebase'
  return 'merge'
}

// ---------------------------------------------------------------------------
// Create + open
// ---------------------------------------------------------------------------

export async function createGiteaPullRequest(
  projectPath: string,
  input: CreatePullRequestInput,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return { ok: false, message: bad }

  // Gitea's create-PR API has no dedicated draft field on every supported
  // version; the `[WIP]` title prefix is the convention that marks a PR as a
  // work-in-progress / draft across both old and new Gitea/Forgejo releases.
  const title =
    input.draft && !/^\s*\[WIP\]/i.test(input.title) ? `[WIP] ${input.title}` : input.title

  const body: Record<string, unknown> = {
    title,
    body: input.body,
    head: input.head,
    base: input.base,
  }

  return runGiteaAction(runner, `repos/${projectPath}/pulls`, 'POST', body, (out) => {
    const pr = out.trim() ? (JSON.parse(out) as { html_url?: string }) : undefined
    const url = pr?.html_url
    return { ok: true, message: url ? `Created pull request: ${url}` : 'Created pull request', url }
  })
}

export function openGiteaPullRequest(url: string): PullRequestActionResult {
  return { ok: true, message: `Open this URL in your browser: ${url}`, url }
}

// ---------------------------------------------------------------------------
// By-number mutations
// ---------------------------------------------------------------------------

export function mergeGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}/merge`,
    'POST',
    { Do: giteaMergeStrategy(strategy) },
    () => ({ ok: true, message: `Merged pull request #${pullRequestNumber} with ${strategy}` })
  )
}

export function approveGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}/reviews`,
    'POST',
    { event: 'APPROVED' },
    () => ({ ok: true, message: `Approved pull request #${pullRequestNumber}` })
  )
}

export function closeGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}`,
    'PATCH',
    { state: 'closed' },
    () => ({ ok: true, message: `Closed pull request #${pullRequestNumber}` })
  )
}

export function commentGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${pullRequestNumber}/comments`,
    'POST',
    { body },
    () => ({ ok: true, message: `Commented on pull request #${pullRequestNumber}` })
  )
}

/**
 * `POST .../reviews` with `event: REQUEST_CHANGES` — Gitea's native
 * request-changes review state (unlike Bitbucket, which has none).
 */
export function requestChangesGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}/reviews`,
    'POST',
    { event: 'REQUEST_CHANGES', body },
    () => ({ ok: true, message: `Requested changes on pull request #${pullRequestNumber}` })
  )
}

async function resolveGiteaLabelId(
  projectPath: string,
  label: string,
  runner: GiteaRunner
): Promise<number | undefined> {
  try {
    const out = (await runner(`repos/${projectPath}/labels?limit=50`)).trim()
    const labels = out ? (JSON.parse(out) as Array<{ id?: number; name?: string }>) : []
    return labels.find((l) => l.name === label)?.id
  } catch {
    return undefined
  }
}

/**
 * Gitea's "add label to issue" endpoint takes label IDs, not names, so this
 * resolves the name to an ID via the repo's label list first.
 */
export async function addGiteaPullRequestLabel(
  projectPath: string,
  pullRequestNumber: number,
  label: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!label.trim()) return { ok: false, message: 'Label name required' }
  const bad = rejectFlagLike(label, 'Label')
  if (bad) return { ok: false, message: bad }

  const id = await resolveGiteaLabelId(projectPath, label, runner)
  if (id === undefined) {
    return { ok: false, message: `Label '${label}' not found on this repository. Create it in Gitea first.` }
  }

  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${pullRequestNumber}/labels`,
    'POST',
    { labels: [id] },
    () => ({ ok: true, message: `Added label '${label}' to pull request #${pullRequestNumber}` })
  )
}

export function addGiteaPullRequestReviewer(
  projectPath: string,
  pullRequestNumber: number,
  username: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!username.trim()) return Promise.resolve({ ok: false, message: 'Reviewer username required' })
  const bad = rejectUnsafeUsername(username)
  if (bad) return Promise.resolve({ ok: false, message: bad })

  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}/requested_reviewers`,
    'POST',
    { reviewers: [username] },
    () => ({ ok: true, message: `Added ${username} as reviewer to pull request #${pullRequestNumber}` })
  )
}

// ---------------------------------------------------------------------------
// Current-branch variants (look up the open PR for the given branch first)
// ---------------------------------------------------------------------------

async function findCurrentBranchPR(
  projectPath: string,
  currentBranch: string,
  runner: GiteaRunner
): Promise<{ number: number } | undefined> {
  try {
    const pr = await findOpenGiteaPullRequestForBranch(projectPath, currentBranch, runner)
    return pr?.number != null ? { number: Number(pr.number) } : undefined
  } catch {
    return undefined
  }
}

function withCurrentBranchPR(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: GiteaRunner,
  action: (pullRequestNumber: number) => Promise<PullRequestActionResult>
): Promise<PullRequestActionResult> {
  if (!projectPath) return Promise.resolve({ ok: false, message: 'No Gitea project path available.' })
  if (!currentBranch) return Promise.resolve({ ok: false, message: 'No current branch (detached HEAD?).' })

  return findCurrentBranchPR(projectPath, currentBranch, runner).then((pr) => {
    if (!pr) return { ok: false, message: `No open pull request found for branch '${currentBranch}'.` }
    return action(pr.number)
  })
}

export function mergeGiteaPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  strategy: PullRequestMergeStrategy,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (n) =>
    mergeGiteaPullRequestByNumber(projectPath as string, n, strategy, runner)
  )
}

export function closeGiteaPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (n) =>
    closeGiteaPullRequestByNumber(projectPath as string, n, runner)
  )
}

export function approveGiteaPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (n) =>
    approveGiteaPullRequestByNumber(projectPath as string, n, runner)
  )
}

export function commentGiteaPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (n) =>
    commentGiteaPullRequestByNumber(projectPath as string, n, body, runner)
  )
}

export function requestChangesGiteaPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (n) =>
    requestChangesGiteaPullRequestByNumber(projectPath as string, n, body, runner)
  )
}
