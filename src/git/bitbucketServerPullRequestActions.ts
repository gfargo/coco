import { runBitbucketServerAction, splitBitbucketServerPath, type BitbucketServerRunner } from './bitbucketServerCli'
import { findOpenBitbucketServerPullRequestForBranch } from './bitbucketServerListData'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import type { CreatePullRequestInput, PullRequestActionResult, PullRequestMergeStrategy } from './pullRequestActions'

/**
 * Bitbucket Server / Data Center pull-request mutations via the REST API
 * 1.0. Each action maps to a Bitbucket Server endpoint; `runner` is a
 * host-bound `BitbucketServerRunner` the forge adapter constructs from the
 * detected repository's host (mirrors Gitea's runner indirection, unlike
 * Bitbucket Cloud's fixed-base default).
 *
 * Merge/decline require the PR's current `version` for optimistic locking —
 * fetched fresh before each call rather than threaded through, since the
 * facade only carries a PR number, not its version.
 *
 * `rebase` (coco vocabulary) maps to the `rebase-no-ff` merge strategy id;
 * omitting `strategyId` entirely uses whatever default the server/repo has
 * configured, which is what `merge` maps to.
 */

function bitbucketServerMergeStrategyId(strategy: PullRequestMergeStrategy): string | undefined {
  if (strategy === 'squash') return 'squash'
  if (strategy === 'rebase') return 'rebase-no-ff'
  return undefined
}

async function getPullRequestVersion(
  runner: BitbucketServerRunner,
  projectKey: string,
  repoSlug: string,
  pullRequestNumber: number
): Promise<number | undefined> {
  try {
    const out = (await runner(`projects/${projectKey}/repos/${repoSlug}/pull-requests/${pullRequestNumber}`)).trim()
    const pr = out ? (JSON.parse(out) as { version?: number }) : undefined
    return typeof pr?.version === 'number' ? pr.version : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Create + open
// ---------------------------------------------------------------------------

export async function createBitbucketServerPullRequest(
  projectPath: string,
  input: CreatePullRequestInput,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return { ok: false, message: bad }

  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return { ok: false, message: 'No Bitbucket Server project resolved' }

  const repository = { slug: parts.repoSlug, project: { key: parts.projectKey } }
  const body: Record<string, unknown> = {
    title: input.title,
    description: input.body,
    fromRef: { id: `refs/heads/${input.head}`, repository },
    toRef: { id: `refs/heads/${input.base}`, repository },
  }
  if (input.draft) body.draft = true

  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests`,
    'POST',
    body,
    (out) => {
      const pr = out.trim() ? (JSON.parse(out) as { links?: { self?: Array<{ href?: string }> } }) : undefined
      const url = pr?.links?.self?.[0]?.href
      return { ok: true, message: url ? `Created pull request: ${url}` : 'Created pull request', url }
    }
  )
}

export function openBitbucketServerPullRequest(url: string): PullRequestActionResult {
  return { ok: true, message: `Open this URL in your browser: ${url}`, url }
}

// ---------------------------------------------------------------------------
// By-number mutations
// ---------------------------------------------------------------------------

export async function mergeBitbucketServerPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return { ok: false, message: 'No Bitbucket Server project resolved' }

  const version = await getPullRequestVersion(runner, parts.projectKey, parts.repoSlug, pullRequestNumber)
  if (version === undefined) {
    return { ok: false, message: `Could not resolve the current version of pull request #${pullRequestNumber}.` }
  }

  const strategyId = bitbucketServerMergeStrategyId(strategy)
  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/merge?version=${version}`,
    'POST',
    strategyId ? { strategyId } : {},
    () => ({ ok: true, message: `Merged pull request #${pullRequestNumber} with ${strategy}` })
  )
}

export function approveBitbucketServerPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return Promise.resolve({ ok: false, message: 'No Bitbucket Server project resolved' })

  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/approve`,
    'POST',
    {},
    () => ({ ok: true, message: `Approved pull request #${pullRequestNumber}` })
  )
}

export async function closeBitbucketServerPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return { ok: false, message: 'No Bitbucket Server project resolved' }

  const version = await getPullRequestVersion(runner, parts.projectKey, parts.repoSlug, pullRequestNumber)
  if (version === undefined) {
    return { ok: false, message: `Could not resolve the current version of pull request #${pullRequestNumber}.` }
  }

  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/decline?version=${version}`,
    'POST',
    {},
    () => ({ ok: true, message: `Declined pull request #${pullRequestNumber}` })
  )
}

export function commentBitbucketServerPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return Promise.resolve({ ok: false, message: 'No Bitbucket Server project resolved' })

  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/comments`,
    'POST',
    { text: body },
    () => ({ ok: true, message: `Commented on pull request #${pullRequestNumber}` })
  )
}

/**
 * Bitbucket Server's native "needs work" review state applies to the
 * authenticated user's own participant entry — there is no lightweight
 * "who am I" endpoint for token auth to resolve that entry against (see
 * `bitbucketServerListData.ts`). Post a comment with a "Requested changes:"
 * prefix instead, mirroring the Bitbucket Cloud and GitLab adapters.
 */
export function requestChangesBitbucketServerPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return Promise.resolve({ ok: false, message: 'No Bitbucket Server project resolved' })

  return runBitbucketServerAction(
    runner,
    `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/comments`,
    'POST',
    { text: `Requested changes: ${body}` },
    () => ({ ok: true, message: `Requested changes on pull request #${pullRequestNumber}` })
  )
}

/** Bitbucket Server pull requests do not support labels. */
export function addBitbucketServerPullRequestLabel(): Promise<PullRequestActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Pull request labels are not supported on Bitbucket Server.',
  })
}

export function addBitbucketServerPullRequestReviewer(
  projectPath: string,
  pullRequestNumber: number,
  username: string,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (!username.trim()) return Promise.resolve({ ok: false, message: 'Reviewer username required' })
  const bad = rejectUnsafeUsername(username)
  if (bad) return Promise.resolve({ ok: false, message: bad })

  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return Promise.resolve({ ok: false, message: 'No Bitbucket Server project resolved' })

  // Bitbucket Server's update endpoint is a full-resource PUT, not a partial
  // patch — fetch the current PR representation and send it back with the
  // reviewer appended, rather than constructing a minimal body by hand.
  return (async () => {
    let pr: Record<string, unknown> | undefined
    try {
      const out = (
        await runner(`projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}`)
      ).trim()
      pr = out ? (JSON.parse(out) as Record<string, unknown>) : undefined
    } catch {
      return { ok: false, message: `Could not fetch pull request #${pullRequestNumber} to add a reviewer.` }
    }

    if (!pr) {
      return { ok: false, message: `Pull request #${pullRequestNumber} not found.` }
    }

    const existing = Array.isArray(pr.reviewers) ? (pr.reviewers as Array<{ user?: { name?: string; slug?: string } }>) : []
    const alreadyAdded = existing.some((r) => r.user?.name === username || r.user?.slug === username)
    if (alreadyAdded) {
      return { ok: true, message: `${username} is already a reviewer on pull request #${pullRequestNumber}` }
    }

    return runBitbucketServerAction(
      runner,
      `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}`,
      'PUT',
      { ...pr, reviewers: [...existing, { user: { name: username } }] },
      () => ({ ok: true, message: `Added ${username} as reviewer to pull request #${pullRequestNumber}` })
    )
  })()
}

// ---------------------------------------------------------------------------
// Current-branch variants (look up the open PR for the given branch first)
// ---------------------------------------------------------------------------

async function findCurrentBranchPR(
  projectPath: string,
  currentBranch: string,
  runner: BitbucketServerRunner
): Promise<{ id: number } | undefined> {
  try {
    const pr = await findOpenBitbucketServerPullRequestForBranch(projectPath, currentBranch, runner)
    return pr?.id != null ? { id: Number(pr.id) } : undefined
  } catch {
    return undefined
  }
}

function withCurrentBranchPR(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketServerRunner,
  action: (prId: number) => Promise<PullRequestActionResult>
): Promise<PullRequestActionResult> {
  if (!projectPath) return Promise.resolve({ ok: false, message: 'No Bitbucket Server project path available.' })
  if (!currentBranch) return Promise.resolve({ ok: false, message: 'No current branch (detached HEAD?).' })

  return findCurrentBranchPR(projectPath, currentBranch, runner).then((pr) => {
    if (!pr) return { ok: false, message: `No open pull request found for branch '${currentBranch}'.` }
    return action(pr.id)
  })
}

export function mergeBitbucketServerPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  strategy: PullRequestMergeStrategy,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    mergeBitbucketServerPullRequestByNumber(projectPath as string, id, strategy, runner)
  )
}

export function closeBitbucketServerPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    closeBitbucketServerPullRequestByNumber(projectPath as string, id, runner)
  )
}

export function approveBitbucketServerPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    approveBitbucketServerPullRequestByNumber(projectPath as string, id, runner)
  )
}

export function commentBitbucketServerPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    commentBitbucketServerPullRequestByNumber(projectPath as string, id, body, runner)
  )
}

export function requestChangesBitbucketServerPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    requestChangesBitbucketServerPullRequestByNumber(projectPath as string, id, body, runner)
  )
}
