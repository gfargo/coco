import {
  buildAzureDevOpsRepoWebUrl,
  resolveAzureDevOpsSelfIdentity,
  runAzureDevOpsAction,
  type AzureDevOpsProject,
  type AzureDevOpsRunner,
} from './azureDevOpsCli'
import { findOpenAzureDevOpsPullRequestForBranch } from './azureDevOpsListData'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import { defaultOpenUrlRunner, type OpenUrlRunner } from './historyActions'
import type { CreatePullRequestInput, PullRequestActionResult, PullRequestMergeStrategy } from './pullRequestActions'

/**
 * Azure DevOps Repos pull-request mutations via the Git REST API. Each
 * action maps to an Azure endpoint; `runner` is an org/project-bound
 * `AzureDevOpsRunner` (see `makeAzureDevOpsRunner` in `azureDevOpsCli.ts`)
 * and `project` carries the org/project/repo coordinates every endpoint
 * needs beyond what the runner's base URL already encodes. Returns the same
 * `PullRequestActionResult` shape as the other forges.
 *
 * Merge strategies: Azure's `completionOptions.mergeStrategy` accepts
 * `noFastForward` (default merge commit), `squash`, `rebase`, and
 * `rebaseMerge` — coco's `squash`/`rebase`/(default) map onto the first
 * three.
 */

function azureDevOpsMergeStrategy(strategy: PullRequestMergeStrategy): string {
  if (strategy === 'squash') return 'squash'
  if (strategy === 'rebase') return 'rebase'
  return 'noFastForward'
}

function repoSegment(project: AzureDevOpsProject): string {
  return encodeURIComponent(project.repo)
}

function pullRequestEndpoint(project: AzureDevOpsProject, pullRequestNumber: number, suffix = ''): string {
  return `git/repositories/${repoSegment(project)}/pullrequests/${pullRequestNumber}${suffix}`
}

// ---------------------------------------------------------------------------
// Create + open
// ---------------------------------------------------------------------------

export async function createAzureDevOpsPullRequest(
  project: AzureDevOpsProject,
  input: CreatePullRequestInput,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  const bad = rejectFlagLike(input.head, 'Branch name') || rejectFlagLike(input.base, 'Branch name')
  if (bad) return { ok: false, message: bad }

  const body: Record<string, unknown> = {
    sourceRefName: `refs/heads/${input.head}`,
    targetRefName: `refs/heads/${input.base}`,
    title: input.title,
    description: input.body,
    isDraft: Boolean(input.draft),
  }

  return runAzureDevOpsAction(runner, `git/repositories/${repoSegment(project)}/pullrequests`, 'POST', body, (out) => {
    const pr = out.trim() ? (JSON.parse(out) as { pullRequestId?: number }) : undefined
    const url = pr?.pullRequestId ? `${buildAzureDevOpsRepoWebUrl(project)}/pullrequest/${pr.pullRequestId}` : undefined
    return { ok: true, message: url ? `Created pull request: ${url}` : 'Created pull request', url }
  })
}

export function openAzureDevOpsPullRequest(
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

async function fetchLastMergeSourceCommitId(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<string | undefined> {
  try {
    const out = (await runner(pullRequestEndpoint(project, pullRequestNumber))).trim()
    if (!out) return undefined
    const pr = JSON.parse(out) as { lastMergeSourceCommit?: { commitId?: string } }
    return pr.lastMergeSourceCommit?.commitId
  } catch {
    return undefined
  }
}

/**
 * Completing an Azure DevOps pull request requires echoing back the source
 * branch's current head commit (`lastMergeSourceCommit.commitId`) as a
 * concurrency guard — the API rejects a completion whose commit id doesn't
 * match the PR's current head, so this fetches it fresh immediately before
 * completing rather than trusting a caller-supplied value.
 */
export async function mergeAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  strategy: PullRequestMergeStrategy,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  const commitId = await fetchLastMergeSourceCommitId(project, pullRequestNumber, runner)
  if (!commitId) {
    return { ok: false, message: `Could not resolve the source commit for pull request #${pullRequestNumber}.` }
  }
  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber),
    'PATCH',
    {
      status: 'completed',
      lastMergeSourceCommit: { commitId },
      completionOptions: { mergeStrategy: azureDevOpsMergeStrategy(strategy) },
    },
    () => ({ ok: true, message: `Merged pull request #${pullRequestNumber} with ${strategy}` })
  )
}

/**
 * Auto-complete (Azure's auto-merge equivalent) needs the same
 * `lastMergeSourceCommit` guard as a regular completion PLUS the caller's
 * own identity id (`autoCompleteSetBy`) — two extra round-trips for a
 * feature whose semantics (which policies must pass, delete-source-branch
 * defaults) differ enough from GitHub/GitLab/Gitea's auto-merge that
 * guessing at them risks surprising behavior. Left as an explicit gap
 * rather than a partial implementation, mirroring the Bitbucket/Bitbucket
 * Server facades' `enableAutoMerge` stubs.
 */
export function enableAzureDevOpsAutoMerge(): Promise<PullRequestActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Auto-merge is not supported for Azure DevOps yet.',
  })
}

/**
 * Azure Pipelines re-run has no single REST call keyed off a commit status
 * the way GitHub Actions/GitLab CI do — it's per-build, and a PR status
 * entry doesn't reliably carry a re-runnable build id. Left as an explicit
 * gap (mirrors `rerunFailedGiteaChecks`).
 */
export function rerunFailedAzureDevOpsChecks(): Promise<PullRequestActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Re-running checks is not supported for Azure DevOps yet.',
  })
}

/**
 * `gh pr checkout` / `glab mr checkout` has no Azure DevOps equivalent —
 * there is no CLI binary this forge shells out to, and the REST API has no
 * "checkout" concept (mirrors the Gitea/Bitbucket facades, #1363).
 */
export function checkoutAzureDevOpsPullRequestByNumber(): Promise<PullRequestActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Pull request checkout is not supported for Azure DevOps yet.',
  })
}

export async function approveAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  const me = await resolveAzureDevOpsSelfIdentity(project.org, runner)
  if (!me?.id) {
    return { ok: false, message: 'Could not resolve your Azure DevOps identity to vote on this pull request.' }
  }
  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber, `/reviewers/${me.id}`),
    'PUT',
    { vote: 10 },
    () => ({ ok: true, message: `Approved pull request #${pullRequestNumber}` })
  )
}

export function closeAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber),
    'PATCH',
    { status: 'abandoned' },
    () => ({ ok: true, message: `Closed pull request #${pullRequestNumber}` })
  )
}

export function reopenAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber),
    'PATCH',
    { status: 'active' },
    () => ({ ok: true, message: `Reopened pull request #${pullRequestNumber}` })
  )
}

/**
 * Promote a draft PR to ready for review (#1933). Unlike Gitea/GitLab's
 * title-convention drafts, Azure DevOps exposes a real `isDraft` boolean, so
 * this is a direct flip — no title parsing needed.
 */
export async function markAzureDevOpsPullRequestReadyByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  try {
    const out = (await runner(pullRequestEndpoint(project, pullRequestNumber))).trim()
    const pr = out ? (JSON.parse(out) as { isDraft?: boolean }) : undefined
    if (pr === undefined) {
      return { ok: false, message: `Could not fetch pull request #${pullRequestNumber}.` }
    }
    if (!pr.isDraft) {
      return { ok: true, message: `Pull request #${pullRequestNumber} is not a draft` }
    }
    return await runAzureDevOpsAction(
      runner,
      pullRequestEndpoint(project, pullRequestNumber),
      'PATCH',
      { isDraft: false },
      () => ({ ok: true, message: `Marked pull request #${pullRequestNumber} as ready for review` })
    )
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function commentAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  body: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber, '/threads'),
    'POST',
    { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 },
    () => ({ ok: true, message: `Commented on pull request #${pullRequestNumber}` })
  )
}

/**
 * Azure has no native "request changes" review state — the closest is the
 * `-5` ("waiting for author") vote, which carries no message on its own, so
 * this casts that vote AND posts the body as a comment thread.
 */
export async function requestChangesAzureDevOpsPullRequestByNumber(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  body: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return { ok: false, message: 'Review body required for change-request' }

  const me = await resolveAzureDevOpsSelfIdentity(project.org, runner)
  if (!me?.id) {
    return { ok: false, message: 'Could not resolve your Azure DevOps identity to vote on this pull request.' }
  }

  const vote = await runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber, `/reviewers/${me.id}`),
    'PUT',
    { vote: -5 },
    () => ({ ok: true, message: '' })
  )
  if (!vote.ok) return vote

  const comment = await commentAzureDevOpsPullRequestByNumber(project, pullRequestNumber, body, runner)
  if (!comment.ok) return comment

  return { ok: true, message: `Requested changes on pull request #${pullRequestNumber}` }
}

/** Azure's PR labels endpoint takes the label name directly — no id lookup needed, unlike Gitea. */
export function addAzureDevOpsPullRequestLabel(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  label: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!label.trim()) return Promise.resolve({ ok: false, message: 'Label name required' })
  const bad = rejectFlagLike(label, 'Label')
  if (bad) return Promise.resolve({ ok: false, message: bad })

  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber, '/labels'),
    'POST',
    { name: label },
    () => ({ ok: true, message: `Added label '${label}' to pull request #${pullRequestNumber}` })
  )
}

async function resolveAzureDevOpsIdentityId(
  org: string,
  usernameOrEmail: string,
  runner: AzureDevOpsRunner
): Promise<string | undefined> {
  try {
    const out = (
      await runner(
        `https://vssps.dev.azure.com/${encodeURIComponent(org)}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(usernameOrEmail)}&queryMembership=None`
      )
    ).trim()
    if (!out) return undefined
    const data = JSON.parse(out) as { value?: Array<{ id?: string }> }
    return data.value?.[0]?.id
  } catch {
    return undefined
  }
}

/**
 * Adding a reviewer needs their identity id (a GUID), not their username —
 * resolved via the identity-search API on `vssps.dev.azure.com` first.
 */
export async function addAzureDevOpsPullRequestReviewer(
  project: AzureDevOpsProject,
  pullRequestNumber: number,
  username: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!username.trim()) return { ok: false, message: 'Reviewer username required' }
  const bad = rejectUnsafeUsername(username)
  if (bad) return { ok: false, message: bad }

  const reviewerId = await resolveAzureDevOpsIdentityId(project.org, username, runner)
  if (!reviewerId) {
    return { ok: false, message: `Could not resolve an Azure DevOps identity for '${username}'.` }
  }

  return runAzureDevOpsAction(
    runner,
    pullRequestEndpoint(project, pullRequestNumber, `/reviewers/${reviewerId}`),
    'PUT',
    { vote: 0, isRequired: true },
    () => ({ ok: true, message: `Added ${username} as reviewer to pull request #${pullRequestNumber}` })
  )
}

// ---------------------------------------------------------------------------
// Current-branch variants (look up the open PR for the given branch first)
// ---------------------------------------------------------------------------

async function findCurrentBranchPR(
  project: AzureDevOpsProject,
  currentBranch: string,
  runner: AzureDevOpsRunner
): Promise<{ number: number } | undefined> {
  try {
    const pr = await findOpenAzureDevOpsPullRequestForBranch(project, currentBranch, runner)
    return pr?.pullRequestId != null ? { number: Number(pr.pullRequestId) } : undefined
  } catch {
    return undefined
  }
}

function withCurrentBranchPR(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  runner: AzureDevOpsRunner,
  action: (pullRequestNumber: number) => Promise<PullRequestActionResult>
): Promise<PullRequestActionResult> {
  if (!project) return Promise.resolve({ ok: false, message: 'No Azure DevOps project resolved.' })
  if (!currentBranch) return Promise.resolve({ ok: false, message: 'No current branch (detached HEAD?).' })

  return findCurrentBranchPR(project, currentBranch, runner).then((pr) => {
    if (!pr) return { ok: false, message: `No open pull request found for branch '${currentBranch}'.` }
    return action(pr.number)
  })
}

export function mergeAzureDevOpsPullRequest(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  strategy: PullRequestMergeStrategy,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(project, currentBranch, runner, (n) =>
    mergeAzureDevOpsPullRequestByNumber(project as AzureDevOpsProject, n, strategy, runner)
  )
}

export function closeAzureDevOpsPullRequest(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(project, currentBranch, runner, (n) =>
    closeAzureDevOpsPullRequestByNumber(project as AzureDevOpsProject, n, runner)
  )
}

export function approveAzureDevOpsPullRequest(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  return withCurrentBranchPR(project, currentBranch, runner, (n) =>
    approveAzureDevOpsPullRequestByNumber(project as AzureDevOpsProject, n, runner)
  )
}

export function commentAzureDevOpsPullRequest(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return withCurrentBranchPR(project, currentBranch, runner, (n) =>
    commentAzureDevOpsPullRequestByNumber(project as AzureDevOpsProject, n, body, runner)
  )
}

export function requestChangesAzureDevOpsPullRequest(
  project: AzureDevOpsProject | undefined,
  currentBranch: string | undefined,
  body: string,
  runner: AzureDevOpsRunner
): Promise<PullRequestActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Review body required for change-request' })
  return withCurrentBranchPR(project, currentBranch, runner, (n) =>
    requestChangesAzureDevOpsPullRequestByNumber(project as AzureDevOpsProject, n, body, runner)
  )
}
