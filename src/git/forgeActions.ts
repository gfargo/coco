import { SimpleGit } from 'simple-git'
import { getProviderRepositoryForGit, type GitProviderType } from './providerData'
import { getPullRequestOverview, type PullRequestOverview } from './pullRequestData'
import type { IssueListFilter, IssueListOverview } from './issuesListData'
import type {
  PullRequestListFilter,
  PullRequestListOverview,
} from './pullRequestListData'
import type { PullRequestDetailResult } from './pullRequestDetailData'
import type { PullRequestDiffResult } from './pullRequestDiffData'
import type { IssueDetailResult } from './issueDetailData'
import type {
  CreatePullRequestInput,
  PullRequestActionResult,
  PullRequestMergeStrategy,
} from './pullRequestActions'
import type { IssueActionResult } from './issueActions'

// GitHub implementations.
import { getPullRequestList } from './pullRequestListData'
import { getIssueList } from './issuesListData'
import { getPullRequestDetail } from './pullRequestDetailData'
import { getIssueDetail } from './issueDetailData'
import { getPullRequestDiff } from './pullRequestDiffData'
import {
  addPullRequestAssignee,
  addPullRequestLabel,
  approvePullRequest,
  approvePullRequestByNumber,
  checkoutPullRequestByNumber,
  closePullRequest,
  closePullRequestByNumber,
  commentPullRequest,
  commentPullRequestByNumber,
  createPullRequest,
  mergePullRequest,
  mergePullRequestByNumber,
  openPullRequest,
  requestChangesPullRequest,
  requestChangesPullRequestByNumber,
} from './pullRequestActions'
import {
  addIssueAssignee,
  addIssueLabel,
  closeIssue,
  commentIssue,
  reopenIssue,
} from './issueActions'

// GitLab implementations.
import { getMergeRequestList, getGitLabIssueList, getMergeRequestOverview } from './gitlabListData'
import { getMergeRequestDetail, getGitLabIssueDetail } from './gitlabDetailData'
import {
  addMergeRequestAssignee,
  addMergeRequestLabel,
  approveMergeRequest,
  approveMergeRequestByNumber,
  checkoutMergeRequestByNumber,
  closeMergeRequest,
  closeMergeRequestByNumber,
  commentMergeRequest,
  commentMergeRequestByNumber,
  createMergeRequest,
  getMergeRequestDiff,
  mergeMergeRequest,
  mergeMergeRequestByNumber,
  openMergeRequest,
  requestChangesMergeRequest,
  requestChangesMergeRequestByNumber,
} from './mergeRequestActions'
import {
  addGitLabIssueAssignee,
  addGitLabIssueLabel,
  closeGitLabIssue,
  commentGitLabIssue,
  reopenGitLabIssue,
} from './gitlabIssueActions'
import { defaultGlabRunner } from './glabCli'

// Bitbucket implementations.
import { getBitbucketPullRequestList, getBitbucketIssueList, getBitbucketPullRequestOverview } from './bitbucketListData'
import { getBitbucketPullRequestDetail, getBitbucketIssueDetail } from './bitbucketDetailData'
import {
  createBitbucketPullRequest,
  openBitbucketPullRequest,
  mergeBitbucketPullRequestByNumber,
  approveBitbucketPullRequestByNumber,
  closeBitbucketPullRequestByNumber,
  commentBitbucketPullRequestByNumber,
  requestChangesBitbucketPullRequestByNumber,
  addBitbucketPullRequestLabel,
  addBitbucketPullRequestReviewer,
  mergeBitbucketPullRequest,
  closeBitbucketPullRequest,
  approveBitbucketPullRequest,
  commentBitbucketPullRequest,
  requestChangesBitbucketPullRequest,
} from './bitbucketPullRequestActions'
import {
  commentBitbucketIssue,
  addBitbucketIssueLabel,
  addBitbucketIssueAssignee,
  closeBitbucketIssue,
  reopenBitbucketIssue,
} from './bitbucketIssueActions'

// Gitea / Forgejo implementations.
import { getGiteaPullRequestList, getGiteaIssueList, getGiteaPullRequestOverview } from './giteaListData'
import { getGiteaPullRequestDetail, getGiteaIssueDetail, getGiteaPullRequestDiff } from './giteaDetailData'
import {
  createGiteaPullRequest,
  openGiteaPullRequest,
  mergeGiteaPullRequestByNumber,
  approveGiteaPullRequestByNumber,
  closeGiteaPullRequestByNumber,
  commentGiteaPullRequestByNumber,
  requestChangesGiteaPullRequestByNumber,
  addGiteaPullRequestLabel,
  addGiteaPullRequestReviewer,
  mergeGiteaPullRequest,
  closeGiteaPullRequest,
  approveGiteaPullRequest,
  commentGiteaPullRequest,
  requestChangesGiteaPullRequest,
} from './giteaPullRequestActions'
import {
  commentGiteaIssue,
  addGiteaIssueLabel,
  addGiteaIssueAssignee,
  closeGiteaIssue,
  reopenGiteaIssue,
} from './giteaIssueActions'
import { makeGiteaRunner } from './giteaCli'

/**
 * Provider-agnostic forge facade. The workstation runtime dispatches every
 * pull-request / issue load and mutation through this interface, so the
 * GitHub (`gh`) vs GitLab (`glab`) choice is made once (from the detected
 * provider) instead of branched at ~25 call sites. Method signatures mirror
 * the GitHub action functions so call sites only change from `fn(...)` to
 * `forge.fn(...)`.
 */
export type ForgeActions = {
  // Lists
  getPullRequestList: (git: SimpleGit, filter: PullRequestListFilter) => Promise<PullRequestListOverview>
  getIssueList: (git: SimpleGit, filter: IssueListFilter) => Promise<IssueListOverview>
  // Detail (number only; GitLab binds the project path internally)
  getPullRequestDetail: (n: number) => Promise<PullRequestDetailResult>
  getIssueDetail: (n: number) => Promise<IssueDetailResult>
  /**
   * Unified patch for a PR / MR by number (#1363). Backs the triage
   * Enter → diff drill-in. Bitbucket has no CLI patch fetch, so its
   * facade returns a graceful `{ ok: false }` explaining the gap.
   */
  getPullRequestDiffByNumber: (n: number) => Promise<PullRequestDiffResult>
  // Pull-request / merge-request mutations by number (triage)
  commentPullRequestByNumber: (n: number, body: string) => Promise<PullRequestActionResult>
  addPullRequestLabel: (n: number, label: string) => Promise<PullRequestActionResult>
  addPullRequestAssignee: (n: number, assignee: string) => Promise<PullRequestActionResult>
  mergePullRequestByNumber: (n: number, strategy: PullRequestMergeStrategy) => Promise<PullRequestActionResult>
  closePullRequestByNumber: (n: number) => Promise<PullRequestActionResult>
  approvePullRequestByNumber: (n: number) => Promise<PullRequestActionResult>
  requestChangesPullRequestByNumber: (n: number, body: string) => Promise<PullRequestActionResult>
  /**
   * `gh pr checkout <n>` / `glab mr checkout <n>` (#1363) — fetch the
   * PR's head branch and switch onto it. Bitbucket has no CLI
   * counterpart, so its facade returns a graceful `{ ok: false }`.
   */
  checkoutPullRequestByNumber: (n: number) => Promise<PullRequestActionResult>
  // Current-branch PR / MR mutations
  mergePullRequest: (strategy: PullRequestMergeStrategy) => Promise<PullRequestActionResult>
  closePullRequest: () => Promise<PullRequestActionResult>
  approvePullRequest: () => Promise<PullRequestActionResult>
  commentPullRequest: (body: string) => Promise<PullRequestActionResult>
  requestChangesPullRequest: (body: string) => Promise<PullRequestActionResult>
  createPullRequest: (input: CreatePullRequestInput) => Promise<PullRequestActionResult>
  openPullRequest: (url: string) => Promise<PullRequestActionResult>
  // Issue mutations
  commentIssue: (n: number, body: string) => Promise<IssueActionResult>
  addIssueLabel: (n: number, label: string) => Promise<IssueActionResult>
  addIssueAssignee: (n: number, assignee: string) => Promise<IssueActionResult>
  closeIssue: (n: number) => Promise<IssueActionResult>
  reopenIssue: (n: number) => Promise<IssueActionResult>
}

const githubActions: ForgeActions = {
  getPullRequestList: (git, filter) => getPullRequestList(git, filter),
  getIssueList: (git, filter) => getIssueList(git, filter),
  getPullRequestDetail: (n) => getPullRequestDetail(n),
  getIssueDetail: (n) => getIssueDetail(n),
  getPullRequestDiffByNumber: (n) => getPullRequestDiff(n),
  commentPullRequestByNumber,
  addPullRequestLabel,
  addPullRequestAssignee,
  mergePullRequestByNumber,
  closePullRequestByNumber,
  approvePullRequestByNumber,
  requestChangesPullRequestByNumber,
  checkoutPullRequestByNumber,
  mergePullRequest,
  closePullRequest,
  approvePullRequest,
  commentPullRequest,
  requestChangesPullRequest,
  createPullRequest,
  openPullRequest,
  commentIssue,
  addIssueLabel,
  addIssueAssignee,
  closeIssue,
  reopenIssue,
}

/**
 * GitLab facade. `host` is the repo's remote hostname (`gitlab.com` or a
 * self-hosted instance) — threaded to the mutating actions so their error-path
 * auth re-probe (`resolveGlabActionError` → `getGlabStatus`) checks the right
 * GitLab instance instead of defaulting to `gitlab.com`. Passing
 * `defaultGlabRunner` explicitly keeps the runner default while reaching the
 * trailing `hostname` slot.
 */
function gitlabActions(path: string | undefined, host?: string): ForgeActions {
  return {
    getPullRequestList: (git, filter) => getMergeRequestList(git, filter),
    getIssueList: (git, filter) => getGitLabIssueList(git, filter),
    getPullRequestDetail: (n) =>
      path ? getMergeRequestDetail(path, n) : Promise.resolve({ ok: false, message: 'No GitLab project resolved' }),
    getIssueDetail: (n) =>
      path ? getGitLabIssueDetail(path, n) : Promise.resolve({ ok: false, message: 'No GitLab project resolved' }),
    getPullRequestDiffByNumber: (n) => getMergeRequestDiff(n, defaultGlabRunner, host),
    commentPullRequestByNumber: (n, body) => commentMergeRequestByNumber(n, body, defaultGlabRunner, host),
    addPullRequestLabel: (n, label) => addMergeRequestLabel(n, label, defaultGlabRunner, host),
    addPullRequestAssignee: (n, assignee) => addMergeRequestAssignee(n, assignee, defaultGlabRunner, host),
    mergePullRequestByNumber: (n, strategy) => mergeMergeRequestByNumber(n, strategy, defaultGlabRunner, host),
    closePullRequestByNumber: (n) => closeMergeRequestByNumber(n, defaultGlabRunner, host),
    approvePullRequestByNumber: (n) => approveMergeRequestByNumber(n, defaultGlabRunner, host),
    requestChangesPullRequestByNumber: (n, body) => requestChangesMergeRequestByNumber(n, body, defaultGlabRunner, host),
    checkoutPullRequestByNumber: (n) => checkoutMergeRequestByNumber(n, defaultGlabRunner, host),
    mergePullRequest: (strategy) => mergeMergeRequest(strategy, defaultGlabRunner, host),
    closePullRequest: () => closeMergeRequest(defaultGlabRunner, host),
    approvePullRequest: () => approveMergeRequest(defaultGlabRunner, host),
    commentPullRequest: (body) => commentMergeRequest(body, defaultGlabRunner, host),
    requestChangesPullRequest: (body) => requestChangesMergeRequest(body, defaultGlabRunner, host),
    createPullRequest: (input) => createMergeRequest(input, defaultGlabRunner, host),
    openPullRequest: (url) => openMergeRequest(url, defaultGlabRunner, host),
    commentIssue: (n, body) => commentGitLabIssue(n, body, defaultGlabRunner, host),
    addIssueLabel: (n, label) => addGitLabIssueLabel(n, label, defaultGlabRunner, host),
    addIssueAssignee: (n, assignee) => addGitLabIssueAssignee(n, assignee, defaultGlabRunner, host),
    closeIssue: (n) => closeGitLabIssue(n, defaultGlabRunner, host),
    reopenIssue: (n) => reopenGitLabIssue(n, defaultGlabRunner, host),
  }
}

/**
 * Bitbucket facade. `path` is `workspace/repo_slug`; `currentBranch` is the
 * checked-out branch (required for current-branch mutations that can't infer
 * the branch from a CLI binary).
 */
function bitbucketActions(
  path: string | undefined,
  currentBranch?: string
): ForgeActions {
  return {
    getPullRequestList: (git, filter) => getBitbucketPullRequestList(git, filter),
    getIssueList: (git, filter) => getBitbucketIssueList(git, filter),
    getPullRequestDetail: (n) =>
      path
        ? getBitbucketPullRequestDetail(path, n)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    getIssueDetail: (n) =>
      path
        ? getBitbucketIssueDetail(path, n)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    // Bitbucket has no CLI patch fetch / checkout — surface the gap as a
    // graceful failure so the diff surface / status line explain it
    // instead of dead-ending (#1363).
    getPullRequestDiffByNumber: () =>
      Promise.resolve({ ok: false, message: 'Pull request diffs are not supported for Bitbucket yet.' }),
    commentPullRequestByNumber: (n, body) => commentBitbucketPullRequestByNumber(path ?? '', n, body),
    addPullRequestLabel: () => addBitbucketPullRequestLabel(),
    addPullRequestAssignee: (n, assignee) => addBitbucketPullRequestReviewer(path ?? '', n, assignee),
    mergePullRequestByNumber: (n, strategy) => mergeBitbucketPullRequestByNumber(path ?? '', n, strategy),
    closePullRequestByNumber: (n) => closeBitbucketPullRequestByNumber(path ?? '', n),
    approvePullRequestByNumber: (n) => approveBitbucketPullRequestByNumber(path ?? '', n),
    requestChangesPullRequestByNumber: (n, body) => requestChangesBitbucketPullRequestByNumber(path ?? '', n, body),
    checkoutPullRequestByNumber: () =>
      Promise.resolve({ ok: false, message: 'Pull request checkout is not supported for Bitbucket yet.' }),
    mergePullRequest: (strategy) => mergeBitbucketPullRequest(path, currentBranch, strategy),
    closePullRequest: () => closeBitbucketPullRequest(path, currentBranch),
    approvePullRequest: () => approveBitbucketPullRequest(path, currentBranch),
    commentPullRequest: (body) => commentBitbucketPullRequest(path, currentBranch, body),
    requestChangesPullRequest: (body) => requestChangesBitbucketPullRequest(path, currentBranch, body),
    createPullRequest: (input) =>
      path
        ? createBitbucketPullRequest(path, input)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    openPullRequest: (url) => Promise.resolve(openBitbucketPullRequest(url)),
    commentIssue: (n, body) => commentBitbucketIssue(path ?? '', n, body),
    addIssueLabel: () => addBitbucketIssueLabel(),
    addIssueAssignee: (n, assignee) => addBitbucketIssueAssignee(path ?? '', n, assignee),
    closeIssue: (n) => closeBitbucketIssue(path ?? '', n),
    reopenIssue: (n) => reopenBitbucketIssue(path ?? '', n),
  }
}

/**
 * Gitea/Forgejo facade. `path` is `owner/repo`; `host` is the repo's remote
 * hostname (a self-hosted install or `codeberg.org`) — unlike Bitbucket's
 * fixed API base, Gitea's REST API lives at `https://<host>/api/v1`, so the
 * facade builds one host-bound runner up front (`makeGiteaRunner`) and passes
 * it to every by-number / current-branch action. `currentBranch` is the
 * checked-out branch, needed for current-branch mutations.
 */
function giteaActions(
  path: string | undefined,
  host: string | undefined,
  currentBranch?: string
): ForgeActions {
  const runner = makeGiteaRunner(host ?? '')

  return {
    getPullRequestList: (git, filter) => getGiteaPullRequestList(git, filter),
    getIssueList: (git, filter) => getGiteaIssueList(git, filter),
    getPullRequestDetail: (n) =>
      path
        ? getGiteaPullRequestDetail(path, n, runner)
        : Promise.resolve({ ok: false, message: 'No Gitea project resolved' }),
    getIssueDetail: (n) =>
      path
        ? getGiteaIssueDetail(path, n, runner)
        : Promise.resolve({ ok: false, message: 'No Gitea project resolved' }),
    getPullRequestDiffByNumber: (n) =>
      path
        ? getGiteaPullRequestDiff(path, n, runner)
        : Promise.resolve({ ok: false, message: 'No Gitea project resolved' }),
    commentPullRequestByNumber: (n, body) => commentGiteaPullRequestByNumber(path ?? '', n, body, runner),
    addPullRequestLabel: (n, label) => addGiteaPullRequestLabel(path ?? '', n, label, runner),
    addPullRequestAssignee: (n, assignee) => addGiteaPullRequestReviewer(path ?? '', n, assignee, runner),
    mergePullRequestByNumber: (n, strategy) => mergeGiteaPullRequestByNumber(path ?? '', n, strategy, runner),
    closePullRequestByNumber: (n) => closeGiteaPullRequestByNumber(path ?? '', n, runner),
    approvePullRequestByNumber: (n) => approveGiteaPullRequestByNumber(path ?? '', n, runner),
    requestChangesPullRequestByNumber: (n, body) =>
      requestChangesGiteaPullRequestByNumber(path ?? '', n, body, runner),
    // Gitea has no CLI/API-friendly single-call checkout — surface the gap as
    // a graceful failure so the diff surface / status line explain it instead
    // of dead-ending (mirrors the Bitbucket facade, #1363).
    checkoutPullRequestByNumber: () =>
      Promise.resolve({ ok: false, message: 'Pull request checkout is not supported for Gitea yet.' }),
    mergePullRequest: (strategy) => mergeGiteaPullRequest(path, currentBranch, strategy, runner),
    closePullRequest: () => closeGiteaPullRequest(path, currentBranch, runner),
    approvePullRequest: () => approveGiteaPullRequest(path, currentBranch, runner),
    commentPullRequest: (body) => commentGiteaPullRequest(path, currentBranch, body, runner),
    requestChangesPullRequest: (body) => requestChangesGiteaPullRequest(path, currentBranch, body, runner),
    createPullRequest: (input) =>
      path
        ? createGiteaPullRequest(path, input, runner)
        : Promise.resolve({ ok: false, message: 'No Gitea project resolved' }),
    openPullRequest: (url) => Promise.resolve(openGiteaPullRequest(url)),
    commentIssue: (n, body) => commentGiteaIssue(path ?? '', n, body, runner),
    addIssueLabel: (n, label) => addGiteaIssueLabel(path ?? '', n, label, runner),
    addIssueAssignee: (n, assignee) => addGiteaIssueAssignee(path ?? '', n, assignee, runner),
    closeIssue: (n) => closeGiteaIssue(path ?? '', n, runner),
    reopenIssue: (n) => reopenGiteaIssue(path ?? '', n, runner),
  }
}

/**
 * Select the forge facade for the detected provider. Anything other than
 * `gitlab`, `bitbucket`, or `gitea` (github, GitHub Enterprise, unsupported)
 * keeps the GitHub `gh` implementations, preserving existing behavior. For
 * GitLab, pass the project path (`owner/name`) and remote host so error-path
 * auth re-probes hit the right instance. For Bitbucket, pass the
 * workspace/repo path and current branch (needed for current-branch
 * mutations that can't infer the branch from a CLI binary). For Gitea, pass
 * the project path, remote host (the REST API base is per-host), and current
 * branch.
 */
export function getForgeActions(
  provider: GitProviderType | undefined,
  options: {
    gitlabPath?: string
    gitlabHost?: string
    bitbucketPath?: string
    giteaPath?: string
    giteaHost?: string
    /** Current checked-out branch, required for Bitbucket/Gitea current-branch PR mutations. */
    currentBranch?: string
  } = {}
): ForgeActions {
  if (provider === 'gitlab') return gitlabActions(options.gitlabPath, options.gitlabHost)
  if (provider === 'bitbucket') return bitbucketActions(options.bitbucketPath, options.currentBranch)
  if (provider === 'gitea') return giteaActions(options.giteaPath, options.giteaHost, options.currentBranch)
  return githubActions
}

/**
 * Current-branch PR/MR overview, dispatched by detecting the provider straight
 * from `git`. Standalone (not part of the ForgeActions facade) because it is
 * also called from non-component contexts (boot context load, legacy
 * interactive log) that don't carry the resolved provider.
 */
export async function getForgePullRequestOverview(git: SimpleGit): Promise<PullRequestOverview> {
  const repo = await getProviderRepositoryForGit(git)
  if (repo?.provider === 'gitlab') return getMergeRequestOverview(git)
  if (repo?.provider === 'bitbucket') return getBitbucketPullRequestOverview(git)
  if (repo?.provider === 'gitea') return getGiteaPullRequestOverview(git)
  return getPullRequestOverview(git)
}
