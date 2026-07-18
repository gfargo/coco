import { bbqlQuote, defaultBitbucketRunner, resolveBitbucketActionError, type BitbucketRunner } from './bitbucketCli'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import type { CreatePullRequestInput, PullRequestActionResult, PullRequestMergeStrategy } from './pullRequestActions'

/**
 * Bitbucket pull-request mutations via the REST API v2. Each action maps to a
 * Bitbucket endpoint; the runner indirection keeps tests fake-able. Returns the
 * same `PullRequestActionResult` shape as the GitHub (`gh`) and GitLab (`glab`)
 * equivalents so the forge adapter dispatches uniformly.
 *
 * Merge strategies: Bitbucket Cloud supports `merge_commit`, `squash`, and
 * `fast_forward`. `rebase` (coco vocabulary) maps to `fast_forward`.
 */

async function runBitbucketAction(
  runner: BitbucketRunner,
  endpoint: string,
  method: string,
  body: Record<string, unknown> | undefined,
  onSuccess: (output: string) => PullRequestActionResult
): Promise<PullRequestActionResult> {
  try {
    const out = await runner(endpoint, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return onSuccess(out)
  } catch (error) {
    const { message, details } = await resolveBitbucketActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

function bitbucketMergeStrategy(strategy: PullRequestMergeStrategy): string {
  if (strategy === 'squash') return 'squash'
  if (strategy === 'rebase') return 'fast_forward'
  return 'merge_commit'
}

// ---------------------------------------------------------------------------
// Create + open
// ---------------------------------------------------------------------------

export async function createBitbucketPullRequest(
  projectPath: string,
  input: CreatePullRequestInput,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return { ok: false, message: bad }

  const body: Record<string, unknown> = {
    title: input.title,
    description: input.body,
    source: { branch: { name: input.head } },
    destination: { branch: { name: input.base } },
  }
  if (input.draft) body.draft = true

  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests`,
    'POST',
    body,
    (out) => {
      const pr = out.trim() ? JSON.parse(out) as { links?: { html?: { href?: string } } } : undefined
      const url = pr?.links?.html?.href
      return { ok: true, message: url ? `Created pull request: ${url}` : 'Created pull request', url }
    }
  )
}

export function openBitbucketPullRequest(url: string): PullRequestActionResult {
  return { ok: true, message: `Open this URL in your browser: ${url}`, url }
}

// ---------------------------------------------------------------------------
// By-number mutations
// ---------------------------------------------------------------------------

export function mergeBitbucketPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests/${pullRequestNumber}/merge`,
    'POST',
    { merge_strategy: bitbucketMergeStrategy(strategy) },
    () => ({ ok: true, message: `Merged pull request #${pullRequestNumber} with ${strategy}` })
  )
}

export function approveBitbucketPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests/${pullRequestNumber}/approve`,
    'POST',
    {},
    () => ({ ok: true, message: `Approved pull request #${pullRequestNumber}` })
  )
}

export function closeBitbucketPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests/${pullRequestNumber}/decline`,
    'POST',
    {},
    () => ({ ok: true, message: `Declined pull request #${pullRequestNumber}` })
  )
}

export function commentBitbucketPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests/${pullRequestNumber}/comments`,
    'POST',
    { content: { raw: body } },
    () => ({ ok: true, message: `Commented on pull request #${pullRequestNumber}` })
  )
}

/**
 * Bitbucket Cloud has no native "request changes" review state. Post a comment
 * with a "Requested changes:" prefix (the same pattern as the GitLab adapter)
 * so the intent is legible in the PR discussion.
 */
export function requestChangesBitbucketPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  body: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/pullrequests/${pullRequestNumber}/comments`,
    'POST',
    { content: { raw: `Requested changes: ${body}` } },
    () => ({ ok: true, message: `Requested changes on pull request #${pullRequestNumber}` })
  )
}

/** Bitbucket Cloud pull requests do not support labels. */
export function addBitbucketPullRequestLabel(): Promise<PullRequestActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Pull request labels are not supported on Bitbucket Cloud.',
  })
}

export function addBitbucketPullRequestReviewer(
  projectPath: string,
  pullRequestNumber: number,
  username: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  if (!username.trim()) return Promise.resolve({ ok: false, message: 'Reviewer username required' })
  const bad = rejectUnsafeUsername(username)
  if (bad) return Promise.resolve({ ok: false, message: bad })

  // Bitbucket requires the reviewer's account_id for PUT /pullrequests/{id}.
  // Resolve it via GET /users/{nickname} first.
  return (async () => {
    let accountId: string | undefined
    try {
      const out = (await runner(`users/${encodeURIComponent(username)}`)).trim()
      const user = out ? JSON.parse(out) as { account_id?: string } : undefined
      accountId = user?.account_id
    } catch {
      return { ok: false, message: `Could not resolve Bitbucket account for user '${username}'.` }
    }

    if (!accountId) {
      return { ok: false, message: `Bitbucket user '${username}' not found.` }
    }

    // Fetch current reviewers so we can append rather than replace.
    let currentReviewers: Array<{ account_id: string }> = []
    try {
      const out = (await runner(`repositories/${projectPath}/pullrequests/${pullRequestNumber}`)).trim()
      const pr = out ? JSON.parse(out) as { reviewers?: Array<{ account_id?: string }> } : undefined
      currentReviewers = (pr?.reviewers ?? []).filter((r) => r.account_id).map((r) => ({ account_id: r.account_id as string }))
    } catch {
      // If we can't fetch current reviewers, proceed with just the new one.
    }

    const alreadyAdded = currentReviewers.some((r) => r.account_id === accountId)
    if (alreadyAdded) {
      return { ok: true, message: `${username} is already a reviewer on pull request #${pullRequestNumber}` }
    }

    return runBitbucketAction(
      runner,
      `repositories/${projectPath}/pullrequests/${pullRequestNumber}`,
      'PUT',
      { reviewers: [...currentReviewers, { account_id: accountId }] },
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
  runner: BitbucketRunner
): Promise<{ id: number } | undefined> {
  try {
    const q = encodeURIComponent(`source.branch.name = "${bbqlQuote(currentBranch)}" AND state = "OPEN"`)
    const out = (await runner(`repositories/${projectPath}/pullrequests?q=${q}&pagelen=1`)).trim()
    const page = out ? JSON.parse(out) as { values?: Array<{ id?: number }> } : undefined
    const pr = page?.values?.[0]
    return pr?.id != null ? { id: Number(pr.id) } : undefined
  } catch {
    return undefined
  }
}

function withCurrentBranchPR(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketRunner,
  action: (prId: number) => Promise<PullRequestActionResult>
): Promise<PullRequestActionResult> {
  if (!projectPath) return Promise.resolve({ ok: false, message: 'No Bitbucket project path available.' })
  if (!currentBranch) return Promise.resolve({ ok: false, message: 'No current branch (detached HEAD?).' })

  return findCurrentBranchPR(projectPath, currentBranch, runner).then((pr) => {
    if (!pr) return { ok: false, message: `No open pull request found for branch '${currentBranch}'.` }
    return action(pr.id)
  })
}

export function mergeBitbucketPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  strategy: PullRequestMergeStrategy,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    mergeBitbucketPullRequestByNumber(projectPath as string, id, strategy, runner)
  )
}

export function closeBitbucketPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    closeBitbucketPullRequestByNumber(projectPath as string, id, runner)
  )
}

export function approveBitbucketPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    approveBitbucketPullRequestByNumber(projectPath as string, id, runner)
  )
}

export function commentBitbucketPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    commentBitbucketPullRequestByNumber(projectPath as string, id, body, runner)
  )
}

export function requestChangesBitbucketPullRequest(
  projectPath: string | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return withCurrentBranchPR(projectPath, currentBranch, runner, (id) =>
    requestChangesBitbucketPullRequestByNumber(projectPath as string, id, body, runner)
  )
}
