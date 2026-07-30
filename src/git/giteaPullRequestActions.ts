import { resolveGiteaActionError, resolveGiteaLabelId, runGiteaAction, type GiteaRunner } from './giteaCli'
import { findOpenGiteaPullRequestForBranch } from './giteaListData'
import { rejectFlagLike, rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'
import { defaultOpenUrlRunner, type OpenUrlRunner } from './historyActions'
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

export function openGiteaPullRequest(
  url: string,
  openUrl: OpenUrlRunner = defaultOpenUrlRunner
): Promise<PullRequestActionResult> {
  return openUrl(url)
    .then(() => ({ ok: true, message: `Opened pull request: ${url}`, url }))
    .catch((error) => ({ ok: false, message: (error as Error).message, url }))
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

export function reopenGiteaPullRequestByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/pulls/${pullRequestNumber}`,
    'PATCH',
    { state: 'open' },
    () => ({ ok: true, message: `Reopened pull request #${pullRequestNumber}` })
  )
}

/**
 * Draft-title prefix Gitea/Forgejo uses on older releases without a real
 * `draft` field — mirrors the `[WIP]` prefix `createGiteaPullRequest` writes.
 */
const GITEA_DRAFT_TITLE_PREFIX = /^\s*\[WIP\]\s*/i

async function fetchGiteaPullRequest(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<{ draft?: boolean; title?: string } | undefined> {
  const out = (await runner(`repos/${projectPath}/pulls/${pullRequestNumber}`)).trim()
  return out ? (JSON.parse(out) as { draft?: boolean; title?: string }) : undefined
}

/**
 * Promote a draft PR to ready for review (#1933), the Gitea counterpart of
 * `gh pr ready`. Mirrors `isDraftPR()` (`giteaListData.ts`): newer
 * Gitea/Forgejo expose a real `draft` boolean, so that takes precedence;
 * only when it's absent does this fall back to stripping the legacy `[WIP]`
 * title prefix `createGiteaPullRequest` writes. A title with no prefix (and
 * no `draft` field) is left untouched (already ready).
 */
export async function markGiteaPullRequestReadyByNumber(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  try {
    const pr = await fetchGiteaPullRequest(projectPath, pullRequestNumber, runner)
    if (pr === undefined) {
      return { ok: false, message: `Could not fetch pull request #${pullRequestNumber}.` }
    }

    if (typeof pr.draft === 'boolean') {
      if (!pr.draft) {
        return { ok: true, message: `Pull request #${pullRequestNumber} is not a draft` }
      }
      return await runGiteaAction(
        runner,
        `repos/${projectPath}/pulls/${pullRequestNumber}`,
        'PATCH',
        { draft: false },
        () => ({ ok: true, message: `Marked pull request #${pullRequestNumber} as ready for review` })
      )
    }

    const title = pr.title ?? ''
    if (!GITEA_DRAFT_TITLE_PREFIX.test(title)) {
      return { ok: true, message: `Pull request #${pullRequestNumber} is not a draft` }
    }
    const readyTitle = title.replace(GITEA_DRAFT_TITLE_PREFIX, '')
    if (!readyTitle.trim()) {
      return {
        ok: false,
        message: `Cannot mark pull request #${pullRequestNumber} ready: the title is only the draft prefix. Rename it first.`,
      }
    }
    return await runGiteaAction(
      runner,
      `repos/${projectPath}/pulls/${pullRequestNumber}`,
      'PATCH',
      { title: readyTitle },
      () => ({ ok: true, message: `Marked pull request #${pullRequestNumber} as ready for review` })
    )
  } catch (error) {
    const { message, details } = await resolveGiteaActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
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
  const bad = rejectUnsafeLabel(label)
  if (bad) return { ok: false, message: bad }

  const lookup = await resolveGiteaLabelId(projectPath, label, runner)
  if (lookup.status === 'not-found') {
    return { ok: false, message: `Label '${label}' not found on this repository. Create it in Gitea first.` }
  }
  if (lookup.status === 'error') {
    return { ok: false, message: `Could not verify label '${label}': ${lookup.message}` }
  }

  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${pullRequestNumber}/labels`,
    'POST',
    { labels: [lookup.id] },
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
