/**
 * The workflow-action dispatcher (extracted in the 0.72 app.ts
 * decomposition, PR 16 — the single largest extraction).
 *
 * This module lifts the ~1,200-line `runWorkflowAction` `React.useCallback`
 * out of `app.ts` wholesale. The callback is the keystroke-driven dispatcher
 * for every confirmable / payload-carrying git workflow: a ~60-entry
 * `handlers` object literal (branch / tag / stash / bisect / commit /
 * file-conflict / worktree / submodule / remote / PR-triage / status / misc
 * ops) followed by the shared try/catch/finally orchestration (remote-op +
 * pending-item loaders, delete-branch-unmerged → confirmation prompt,
 * checkout-branch conflict detection, history-mutation re-fetch, and the
 * stash / gitignore / status special-flow refreshes).
 *
 * Discipline: the callback body AND its 18-item dependency array are
 * reproduced byte-for-byte from `app.ts`. The three inline helpers
 * (`runApplyHunk`, `invalidateIssueListCaches`,
 * `invalidatePullRequestListCaches`) stay INLINE inside the moved callback,
 * the `handlers` object is unchanged, and the post-handler logic carries
 * over verbatim. To keep the body + dep-array text identical, the big
 * objects (`context`, `state`) are passed WHOLE — so reads like
 * `state.selectedBranchIndex` and dep-array entries like `state.branchSort`
 * are unchanged from the original.
 *
 * `runWorkflowAction` is invoked ONLY from the input handler's keystroke
 * dispatch (`runWorkflowAction` event) — it appears in NO `useEffect` /
 * `useMemo` dependency array — so co-locating it here is identity-safe.
 *
 * The two module-level helpers the callback owns (`REMOTE_OP_LOADERS` and
 * `resolvePendingItemAction`) are used ONLY by `runWorkflowAction`, so they
 * move here alongside it. `lastDroppedStashRef` is likewise read only by
 * this callback (the `drop-stash` / `undo-drop-stash` flows), so its
 * `React.useRef` is declared INSIDE the hook at its original relative slot.
 *
 * The action functions the handlers call are imported directly here rather
 * than threaded; `git` / `dispatch` / the three refresh callbacks / the
 * context+status setters / `forge` / the filtered lists are threaded in via
 * the deps bag.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import {
    LogInkContextStatus,
    updateLogInkContextStatus,
} from '../../chrome/context'
import { forgeNouns } from '../../chrome/forgeNouns'
import { openProviderUrl } from '../../../git/providerActions'
import type { GitProviderType } from '../../../git/providerData'
import { getSelectedBranchId, getSelectedBranch, getSelectedBranchBatch, getSelectedTagId, getSelectedTag, getSelectedStash, getSelectedStashBatch, getSelectedWorktreeId, getSelectedWorktree } from '../selection'
import {
    LogInkPendingItemAction,
    LogInkAction,
    LogInkState,
    RemoteOpState,
    getSelectedInkCommit,
} from '../inkViewModel'
import {
    checkoutBranch,
    checkoutBranchByName,
    createBranch,
    deleteBranches,
    isBranchCheckedOutElsewhereError,
    isBranchNotFullyMergedError,
    isDirtyWorktreeCheckoutError,
    parseCheckedOutWorktreePath,
    fetchBranch,
    fetchRemotes,
    pullBranch,
    pullCurrentBranch,
    pushBranch,
    pushCurrentBranch,
    renameBranch,
    setUpstream,
    forcePushBranch,
    forcePushCurrentBranch,
    isDivergedPullError,
    isNonFastForwardPushError,
    pullCurrentBranchMerge,
    pullCurrentBranchRebase,
} from '../../../git/branchActions'
import { addToGitignore } from '../../../git/gitignore'
import { createLightweightTag, deleteLocalTag, deleteRemoteTag, pushTag } from '../../../git/tagActions'
import {
    ResetMode,
    checkoutFileFromCommit,
    cherryPickCommit,
    createBranchFromCommit,
    createTagAtCommit,
    defaultOpenUrlRunner,
    isResetMode,
    resetToCommit,
    revertCommit,
    startInteractiveRebase,
    createFixupCommit,
    autosquashRebase,
    amendHeadCommit,
    rewordHeadCommit,
} from '../../../git/historyActions'
import { applyStash, applyStashKeepIndex, checkoutFileFromStash, createStash, dropStashes, popStash, renameStash, restoreStash, stashBranch } from '../../../git/stashActions'
import { ApplyHunkTarget, applyHunkPatch } from '../../../git/hunkActions'
import { removeWorktree, removeWorktreeAndBranch } from '../../../git/worktreeActions'
import { rebaseOnto } from '../../../git/rebaseActions'
import { abortOperation, continueOperation, isOperationConflictError, resolveConflictKeepCurrentBranch, resolveConflictKeepIncoming, stageConflictResolved } from '../../../git/operationActions'
import { getForgeActions } from '../../../git/forgeActions'
import { clearGitHubListCache } from '../../../git/githubListCache'
import { isPullRequestMergeStrategy } from '../../../git/pullRequestActions'
import {
    stageAll,
    stageAllFiles,
    stagePathspec,
    unstageAllFiles,
} from '../../../git/statusActions'
import { applyStatusFilterMask } from '../../../git/statusData'
import { bisectBad, bisectGood, bisectReset, bisectRun, bisectSkip, bisectStart, extractBisectRemainingHint } from '../../../git/bisectActions'
import { checkoutReflogEntry, performReflogUndo, planReflogUndo } from '../../../git/reflogActions'
import { executeRebasePlan } from '../../../git/rebasePlanActions'
import { initSubmodule, syncSubmodule, updateSubmodule } from '../../../git/submoduleActions'
import { addRemote, pruneRemote, removeRemote, setRemoteUrl } from '../../../git/remoteActions'
import { matchesPromotedFilter } from '../promotedFilter'
import type { RepoStackRuntimes } from '../repoStackRuntime'
import type { LogInkContext } from '../types'

// Element types are derived from `LogInkContext` indexed access so they track
// the real overview shapes without re-importing each one (mirrors the
// convention in `buildFilteredLists` / `useYankActions`).
type RemoteListItem = NonNullable<LogInkContext['remotes']>['entries'][number]
type ReflogListItem = NonNullable<LogInkContext['reflog']>['entries'][number]
type SubmoduleListItem = NonNullable<LogInkContext['submodules']>['entries'][number]
type IssueListItem = NonNullable<NonNullable<LogInkContext['issueList']>['issues']>[number]
type PullRequestListItem =
  NonNullable<NonNullable<LogInkContext['pullRequestList']>['pullRequests']>[number]

// Workflow action ids that hit the network (fetch / pull / push) →
// the loader copy shown over the history surface while they run. Any
// id NOT in this map runs without the full-screen loader (local-only
// mutations repaint fast enough that a loader would just flicker).
const REMOTE_OP_LOADERS: Record<string, RemoteOpState> = {
  'fetch-remotes': { kind: 'fetch', label: 'Fetching all remotes…' },
  'pull-current-branch': { kind: 'pull', label: 'Pulling from origin…' },
  'push-current-branch': { kind: 'push', label: 'Pushing to origin…' },
  'fetch-selected-branch': { kind: 'fetch', label: 'Fetching branch from remote…' },
  'pull-selected-branch': { kind: 'pull', label: 'Pulling branch from remote…' },
  'push-selected-branch': { kind: 'push', label: 'Pushing branch to remote…' },
  'force-push-current-branch': { kind: 'push', label: 'Force-pushing (with lease)…' },
  'force-push-selected-branch': { kind: 'push', label: 'Force-pushing branch (with lease)…' },
  'pull-rebase-current': { kind: 'pull', label: 'Pulling with rebase…' },
  'pull-merge-current': { kind: 'pull', label: 'Pulling with merge…' },
}

/**
 * Resolve which list row a delete workflow is about to act on, so the
 * runner can mark it pending (inline spinner) for the duration of the
 * git call. Mirrors the cursored-target resolution inside each delete
 * handler exactly — same sort, same promoted-filter, same selection
 * index — so the spinner lands on the row that actually gets deleted.
 * Returns `undefined` for non-delete workflows (and when nothing is
 * selected), which the runner treats as "no pending marker".
 */
/**
 * Workflow ids whose SUCCESS rewrote local history — the moments where
 * advertising the reflog time machine actually matters (#1355). The
 * shared result dispatch appends `gr reflog to recover` for these.
 * Deliberately excludes ref-only moves (checkout, fetch/pull/push) and
 * additive commits: recovery hints on operations nobody regrets are
 * noise.
 */
export const HISTORY_REWRITE_WORKFLOW_IDS = new Set([
  'reset-to-commit',
  'cherry-pick-commit',
  'revert-commit',
  'fixup-into-commit',
  'autosquash-rebase',
  'interactive-rebase',
  'execute-rebase-plan',
  'rebase-onto-branch',
  'amend-head',
  'reword-head',
])

export function isHistoryRewriteWorkflow(id: string): boolean {
  return HISTORY_REWRITE_WORKFLOW_IDS.has(id)
}

/**
 * Workflow ids whose SUCCESS changes the commits shown in the history pane
 * (#945 follow-up) — either by rewriting/creating local commits or by
 * moving which branch's history is being viewed. The runner does an
 * explicit `refreshHistoryRows()` for these; metadata-only mutations
 * (delete-tag, set-upstream, etc.) are deliberately excluded.
 */
export const HISTORY_MUTATING_WORKFLOW_IDS = new Set([
  'checkout-branch',
  'fixup-into-commit',
  'autosquash-rebase',
  // Amend/reword rewrite the HEAD commit in place (#1350).
  'amend-head',
  'reword-head',
  'execute-rebase-plan',
  'force-push-current-branch',
  'force-push-selected-branch',
  'pull-rebase-current',
  'pull-merge-current',
  // Resolving a checkout conflict changes HEAD (checkout) and/or the
  // ref set (branch delete), so the graph needs a refresh.
  'conflict-remove-worktree-checkout',
  'conflict-remove-worktree-branch',
  'continue-operation',
  'pull-current-branch',
  // Fetch / pull / push bring in new commits and move
  // remote-tracking refs (origin/main, ahead/behind) — refresh the
  // graph so they appear instead of staying pinned to the pre-sync
  // state. (A successful push advances the local origin/<branch>
  // ref, so the chip should hop to the pushed commit.)
  'fetch-remotes',
  'fetch-selected-branch',
  'pull-selected-branch',
  'push-current-branch',
  'push-selected-branch',
  'cherry-pick-commit',
  'revert-commit',
  'reset-to-commit',
  'interactive-rebase',
  // Rebasing the current branch onto a ref rewrites its commits —
  // refresh the graph so the replayed history (or the mid-rebase
  // conflict state) shows instead of staying pinned to the pre-rebase
  // tip.
  'rebase-onto-branch',
  'bisect-good',
  'bisect-bad',
  'bisect-skip',
  'bisect-reset',
  // Checking out the newly-created branch from create-branch-here
  // changes HEAD — refresh the graph so the current-branch marker
  // and history view reflect the switch (#1326).
  'checkout-created-branch',
  // `gh pr checkout <n>` fetches the PR branch and moves HEAD onto
  // it — refresh so the PR's commits and the current-branch marker
  // appear (#1363).
  'triage-pr-checkout',
  // Stash & switch (#1360) changes HEAD the same way a plain
  // checkout does.
  'stash-and-checkout-branch',
  // Stash & switch onto a PR (#1430) moves HEAD via `gh pr checkout`
  // the same way `triage-pr-checkout` does.
  'stash-and-checkout-pr',
  // #1361 — global undo moves HEAD either way (checkout back to the
  // previous branch, or reset --hard to the previous commit).
  'global-undo',
])

export function resolvePendingItemAction(
  id: string,
  state: LogInkState,
  context: LogInkContext
): LogInkPendingItemAction | undefined {
  const { filter } = state

  // #1452 — branch resolution uses the id-based selector. The selector
  // encapsulates sort + filter + index→item, removing the duplicated
  // logic that was previously inlined here for each branch workflow.
  if (id === 'checkout-branch') {
    const branchId = getSelectedBranchId(state, context)
    return branchId ? { kind: 'branch', ids: [branchId], action: 'checkout' } : undefined
  }
  if (id === 'delete-branch' || id === 'force-delete-branch') {
    // #1361 — the delete workflows are batch-capable (`targets: 'multi'`
    // in the registry): resolve through the range → marks → cursor
    // ladder so the confirm target line and the row spinners cover
    // every branch the handler will act on.
    const branches = getSelectedBranchBatch(state, context)
    return branches.length > 0
      ? { kind: 'branch', ids: branches.map((b) => b.shortName), action: 'delete' }
      : undefined
  }
  if (id === 'delete-tag') {
    const tagId = getSelectedTagId(state, context)
    return tagId ? { kind: 'tag', ids: [tagId], action: 'delete' } : undefined
  }
  if (id === 'drop-stash') {
    // #1361 — batch-capable (`targets: 'multi'`): range → marks → cursor.
    const stashes = getSelectedStashBatch(state, context)
    return stashes.length > 0
      ? { kind: 'stash', ids: stashes.map((s) => s.ref), action: 'delete' }
      : undefined
  }
  if (id === 'remove-worktree') {
    const worktreeId = getSelectedWorktreeId(state, context)
    return worktreeId ? { kind: 'worktree', ids: [worktreeId], action: 'delete' } : undefined
  }
  // #1363 — `gh pr checkout <n>` gets the same inline row spinner as a
  // branch checkout. Resolution mirrors `buildFilteredLists`'s triage
  // filter fields so the spinner lands on exactly the row the handler
  // will act on.
  if (id === 'triage-pr-checkout') {
    const all = context.pullRequestList?.pullRequests || []
    const visible = filter
      ? all.filter((pr) =>
          matchesPromotedFilter(
            [
              `#${pr.number}`,
              pr.title,
              pr.author || '',
              pr.headRefName,
              pr.baseRefName,
              ...(pr.labels || []),
              ...(pr.assignees || []),
            ],
            filter
          )
        )
      : all
    const pr = visible[Math.min(state.selectedPullRequestTriageIndex, Math.max(0, visible.length - 1))]
    return pr ? { kind: 'pull-request', ids: [String(pr.number)], action: 'checkout' } : undefined
  }
  return undefined
}

export type UseWorkflowActionDeps = {
  /** The active frame's `git` handle. */
  git: SimpleGit
  /** The active frame's context — branch / tag / stash / submodule / etc. lists. */
  context: LogInkContext
  /** The reducer state — active view, selection indices, filter, sort modes. */
  state: LogInkState
  /** Reducer dispatch — drives status, pending-choice, remote-op, pending-item. */
  dispatch: (action: LogInkAction) => void
  /** Loud / silent repository-context refresh. */
  refreshContext: (options?: { silent?: boolean }) => Promise<void>
  /** Re-fetch the history rows (post history-mutation). */
  refreshHistoryRows: () => Promise<void>
  /**
   * Loud / silent worktree-context refresh. Returns the fresh overview
   * (`Promise<WorktreeOverview | undefined>` in `app.ts`); every call here
   * awaits-and-ignores it, so `Promise<unknown>` is the precise contract.
   */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
  /**
   * The repo-stack runtimes (#1384) — `runtimes.length - 1` at keystroke
   * time is the frame-tag depth the cache-invalidation helpers pass to
   * `setContext` / `setContextStatus`, so a triage mutation that finishes
   * after a repo-frame push / pop still writes to (or is dropped with)
   * the frame that issued it.
   */
  runtimes: RepoStackRuntimes
  /** Frame-aware context setter (used by the issue / PR cache-invalidation helpers). */
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
  /** Frame-aware context-status setter (paired with `setContext`). */
  setContextStatus: (
    arg: LogInkContextStatus | ((prev: LogInkContextStatus) => LogInkContextStatus),
    targetDepth?: number,
  ) => void
  /** The resolved forge action bundle (issue / PR mutations). */
  forge: ReturnType<typeof getForgeActions>
  /** The active provider id (drives `forgeNouns` copy). */
  forgeProvider: GitProviderType | undefined
  /** Filtered remote list (remote-op target resolution). */
  filteredRemoteList: RemoteListItem[]
  /** Filtered reflog list (reflog-view target resolution). */
  filteredReflogList: ReflogListItem[]
  /** Filtered submodule list (submodule-view target resolution). */
  filteredSubmoduleList: SubmoduleListItem[]
  /** Filtered issue list (issue-triage target resolution). */
  filteredIssueList: IssueListItem[]
  /** Filtered PR-triage list (PR-triage target resolution). */
  filteredPullRequestTriageList: PullRequestListItem[]
}

export type UseWorkflowActionResult = {
  runWorkflowAction: (id: string, payload?: string) => Promise<void>
}

export function useWorkflowAction(
  React: typeof ReactTypes,
  deps: UseWorkflowActionDeps,
): UseWorkflowActionResult {
  // Render-fresh snapshot of every input. The callback below is memoized
  // once and reads all render-scoped values through this ref at CALL time,
  // so a keystroke can never execute against the state of an earlier
  // render. (The previous design closed over `state`/the filtered lists
  // and enumerated their fields in the dep array; the array undercounted —
  // it omitted `selectedIndex`, `selectedReflogIndex`, the triage indices
  // and `activeView` — so cursor movement didn't regenerate the callback
  // and cherry-pick / revert / reset / reflog-checkout / triage merge
  // targeted the previously-cursored item.)
  const depsRef = React.useRef(deps)
  depsRef.current = deps

  // Last dropped stash {hash, message}, captured before `drop-stash` runs
  // so `undo-drop-stash` can re-store it. The dropped commit survives in
  // the object DB until gc, so the hash is enough to bring it back. Owned
  // exclusively by `runWorkflowAction` (the `drop-stash` / `undo-drop-stash`
  // flows) — declared inside the hook at its original relative slot.
  const lastDroppedStashRef = React.useRef<{ hash: string; message: string } | null>(null)

  // Last fixup target {hash, shortHash, message}, captured when
  // `fixup-into-commit` succeeds so the follow-up `autosquash-rebase`
  // (offered via choice prompt, which carries no payload) knows which
  // commit's parent to rebase from.
  const lastFixupTargetRef = React.useRef<{ hash: string; shortHash: string; message: string } | null>(null)

  // Ownership tokens for the shared loader state (#1385). Workflow
  // keystrokes stay live while a remote op runs, so two invocations can
  // overlap — e.g. `F` (fetch) then `p` (push) mid-fetch. Without a
  // guard, the fetch's `finally` unconditionally dispatched
  // `setRemoteOp undefined` and killed the push's loader while the push
  // was still running (and likewise for the per-row pending spinner).
  // Each invocation that installs a loader claims the next token; the
  // `finally` clears the loader only when its claim is still the latest
  // — i.e. no later invocation has installed its own loader since. Same
  // identity-check-before-cleanup shape as the AbortController guard in
  // `useChangelogActions`' finally.
  const remoteOpClaimRef = React.useRef(0)
  const pendingItemActionClaimRef = React.useRef(0)

  const runWorkflowAction = React.useCallback(async (id: string, payload?: string) => {
    // Resolve the live snapshot first — every name below shadows what the
    // old closure captured, keeping the ~1,200-line body byte-identical.
    const {
      git,
      context,
      state,
      dispatch,
      refreshContext,
      refreshHistoryRows,
      refreshWorktreeContext,
      runtimes,
      setContext,
      setContextStatus,
      forge,
      forgeProvider,
      filteredRemoteList,
      filteredReflogList,
      filteredSubmoduleList,
      filteredIssueList,
      filteredPullRequestTriageList,
    } = depsRef.current
    // #1384 — capture the repo-frame depth at keystroke time, BEFORE any
    // handler awaits. The invalidation helpers below run after the git /
    // forge mutation resolves; frame-tagging their writes means a
    // drill-in (or pop) that happens mid-mutation can't get its list
    // cleared by the parent frame's completion — the write lands on the
    // issuing frame, or silently drops if that frame was popped.
    const issuedAtDepth = runtimes.length - 1

    // `worktreeDirty` is a pure derivation of the (already-threaded) whole
    // `context.worktree` — derived from the same live snapshot.
    const worktreeDirty = Boolean(
      context.worktree &&
      (context.worktree.stagedCount + context.worktree.unstagedCount + context.worktree.untrackedCount) > 0
    )
    // Hunk-apply payload format: `<target>\n<patchText>` — the input
    // handler synthesizes both pieces (target from the keystroke,
    // patch text from extractDiffHunk against the live diff lines)
    // and packs them into the single `payload` field. Splitting on
    // the first newline keeps the patch body intact.
    const runApplyHunk = (
      expectedTarget: ApplyHunkTarget,
      raw: string | undefined
    ): Promise<{ ok: boolean; message: string; details?: string[] }> => {
      if (!raw) {
        return Promise.resolve({ ok: false, message: 'No hunk under cursor to apply.' })
      }
      const newlineIndex = raw.indexOf('\n')
      if (newlineIndex < 0) {
        return Promise.resolve({ ok: false, message: 'Malformed hunk-apply payload.' })
      }
      const target = raw.slice(0, newlineIndex) === 'index' ? 'index' : 'worktree'
      const patchText = raw.slice(newlineIndex + 1)
      // The input handler is the source of truth for target — but if a
      // palette-injected payload mismatches the workflow id, prefer
      // the workflow id so the user sees the action they asked for.
      const effectiveTarget = expectedTarget || target
      return applyHunkPatch(git, patchText, { target: effectiveTarget })
    }

    // #882 phase 4 — post-mutation cache invalidation for the
    // issue / PR triage views. Each helper does two things:
    //   1. Clears the in-memory `context.issueList` /
    //      `context.pullRequestList` entry so the view's `useEffect`
    //      retriggers on the next render and the user sees their
    //      change reflected immediately.
    //   2. Wipes the disk cache so a follow-up `coco issues` /
    //      `coco prs` CLI call doesn't serve stale data from the
    //      5-minute TTL window. Sledgehammer rather than scalpel —
    //      clearing per (repo, filter) tuple would require more
    //      bookkeeping than the cache is worth.
    const invalidateIssueListCaches = (issueNumber?: number): void => {
      setContext((current) => {
        const next = { ...current, issueList: undefined }
        // Drop only the mutated issue's detail entry so other
        // hydrated entries survive — they're still accurate. When
        // no number is given (rare), wipe the whole detail map.
        if (current.issueDetailByNumber) {
          if (typeof issueNumber === 'number') {
            const trimmed = new Map(current.issueDetailByNumber)
            trimmed.delete(issueNumber)
            next.issueDetailByNumber = trimmed
          } else {
            next.issueDetailByNumber = undefined
          }
        }
        return next
      }, issuedAtDepth)
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'issueList', 'idle'),
        issuedAtDepth,
      )
      clearGitHubListCache()
    }
    const invalidatePullRequestListCaches = (pullRequestNumber?: number): void => {
      setContext((current) => {
        const next = { ...current, pullRequestList: undefined }
        if (current.pullRequestDetailByNumber) {
          if (typeof pullRequestNumber === 'number') {
            const trimmed = new Map(current.pullRequestDetailByNumber)
            trimmed.delete(pullRequestNumber)
            next.pullRequestDetailByNumber = trimmed
          } else {
            next.pullRequestDetailByNumber = undefined
          }
        }
        return next
      }, issuedAtDepth)
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'),
        issuedAtDepth,
      )
      clearGitHubListCache()
    }

    const handlers: Record<string, () => Promise<{ ok: boolean; message: string } | undefined>> = {
      'create-branch': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Branch name required' }
        const startPoint = context.branches?.currentBranch || 'HEAD'
        return createBranch(git, name, startPoint)
      },
      'create-tag': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Tag name required' }
        return createLightweightTag(git, name, 'HEAD')
      },
      'checkout-branch': async () => {
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        if (branch.current) return { ok: true, message: `Already on ${branch.shortName}` }
        return checkoutBranch(git, branch)
      },
      // #1361 — batch-capable (`targets: 'multi'`): resolves the range →
      // marks → cursor ladder and deletes every target, continuing past
      // per-branch refusals with a summary. The single-cursor case
      // degrades to exactly the old behavior (batch of one delegates to
      // deleteBranch).
      'delete-branch': async () => {
        const branches = getSelectedBranchBatch(state, context)
        if (branches.length === 0) return { ok: false, message: 'No branch selected' }
        return deleteBranches(git, branches)
      },
      'force-delete-branch': async () => {
        const branches = getSelectedBranchBatch(state, context)
        if (branches.length === 0) return { ok: false, message: 'No branch selected' }
        return deleteBranches(git, branches, true)
      },
      // #0.71 — rebase the current branch onto the cursored branch / ref.
      // Re-resolve BOTH branches off live context (the input-layer guards
      // already gated the keystroke, but the confirm prompt sits between
      // the keystroke and here, so the cursor / current branch could have
      // moved — re-checking keeps the executed op honest). A conflict
      // leaves the repo mid-rebase; the post-handler refreshContext below
      // reloads the operation overview so the `gx` / `A` surfaces reflect
      // it. No `--continue` / `--abort` here — those live on the existing
      // in-progress-operation surfaces by design.
      'rebase-onto-branch': async () => {
        const current = context.branches?.currentBranch
        if (!current) {
          return { ok: false, message: 'Detached HEAD — checkout a branch before rebasing onto a ref.' }
        }
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        if (branch.shortName === current) {
          return { ok: false, message: 'Cannot rebase a branch onto itself.' }
        }
        return rebaseOnto(git, branch.shortName)
      },
      'delete-tag': async () => {
        const tag = getSelectedTag(state, context)
        if (!tag) return { ok: false, message: 'No tag selected' }
        return deleteLocalTag(git, tag.name)
      },
      'push-tag': async () => {
        const tag = getSelectedTag(state, context)
        if (!tag) return { ok: false, message: 'No tag selected' }
        return pushTag(git, tag.name)
      },
      // #1361 — batch-capable (`targets: 'multi'`): resolves the range →
      // marks → cursor ladder and drops every target, continuing past
      // per-stash refusals with a summary. `undo-drop-stash` only ever
      // remembers one stash, so a batch captures the MOST RECENT one in
      // the set (lowest stash@{N}) — the single-drop case is unaffected
      // (batch of one).
      'drop-stash': async () => {
        const stashes = getSelectedStashBatch(state, context)
        if (stashes.length === 0) return { ok: false, message: 'No stash selected' }
        const mostRecent = [...stashes].sort((a, b) => {
          const parse = (ref: string) => Number(ref.match(/^stash@\{(\d+)\}$/)?.[1] ?? Infinity)
          return parse(a.ref) - parse(b.ref)
        })[0]
        if (mostRecent.hash) {
          lastDroppedStashRef.current = { hash: mostRecent.hash, message: mostRecent.message }
        }
        return dropStashes(git, stashes)
      },
      'undo-drop-stash': async () => {
        const dropped = lastDroppedStashRef.current
        if (!dropped) return { ok: false, message: 'Nothing to undo — no stash dropped this session' }
        const result = await restoreStash(git, dropped.hash, dropped.message)
        if (result.ok) lastDroppedStashRef.current = null
        return result
      },
      'apply-stash': async () => {
        const stash = getSelectedStash(state, context)
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStash(git, stash)
      },
      'apply-stash-index': async () => {
        const stash = getSelectedStash(state, context)
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStashKeepIndex(git, stash)
      },
      'pop-stash': async () => {
        const stash = getSelectedStash(state, context)
        if (!stash) return { ok: false, message: 'No stash selected' }
        return popStash(git, stash)
      },
      'rename-stash': async () => {
        const stash = getSelectedStash(state, context)
        if (!stash) return { ok: false, message: 'No stash selected' }
        return renameStash(git, stash, payload ?? '')
      },
      'stash-branch': async () => {
        const stash = getSelectedStash(state, context)
        if (!stash) return { ok: false, message: 'No stash selected' }
        return stashBranch(git, stash, payload ?? '')
      },
      'bisect-good': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectGood(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Marked good' }
        } catch (error) {
          return { ok: false, message: `Bisect good failed: ${(error as Error).message}` }
        }
      },
      'bisect-bad': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectBad(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Marked bad' }
        } catch (error) {
          return { ok: false, message: `Bisect bad failed: ${(error as Error).message}` }
        }
      },
      'bisect-skip': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectSkip(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Skipped' }
        } catch (error) {
          return { ok: false, message: `Bisect skip failed: ${(error as Error).message}` }
        }
      },
      'bisect-reset': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          await bisectReset(git)
          return { ok: true, message: 'Bisect reset' }
        } catch (error) {
          return { ok: false, message: `Bisect reset failed: ${(error as Error).message}` }
        }
      },
      'bisect-run': async () => {
        // #879 item 5 — drive an automated bisect via `git bisect run
        // sh -c '<command>'`. Synchronous from our perspective: git
        // runs the loop, blocks until termination, then we surface
        // the last meaningful line of stdout (typically "<sha> is
        // the first bad commit") via the status line. Live streaming
        // + cancel mid-run is a follow-up.
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        const command = payload?.trim()
        if (!command) return { ok: false, message: 'Bisect run needs a command' }
        try {
          const stdout = await bisectRun(git, command)
          // Bisect run can advance HEAD across many commits when
          // testing — refresh both the metadata context AND the
          // history rows so the user sees what `git log` actually
          // shows now.
          await refreshHistoryRows()
          await refreshContext({ silent: true })
          return {
            ok: true,
            message: extractBisectRemainingHint(stdout) || `Bisect run finished (${command})`,
          }
        } catch (error) {
          return { ok: false, message: `Bisect run failed: ${(error as Error).message}` }
        }
      },
      'bisect-start-from-history': async () => {
        // #879 item 4 — in-TUI wizard payload: `<bad>\n<good>`. The
        // input handler captures both shas off cursor selections and
        // routes through this workflow so the validation +
        // side-effects live in the runtime rather than the input
        // dispatcher. On success we clear the wizard mode and push
        // the bisect view so the user lands on the new candidate
        // (the candidate-detail loader from item 2 takes over from
        // there).
        const parts = payload?.split('\n') ?? []
        const badRef = parts[0]?.trim()
        const goodRef = parts[1]?.trim()
        if (!badRef || !goodRef) {
          return { ok: false, message: 'Bisect start needs a BAD and a GOOD commit' }
        }
        if (badRef === goodRef) {
          return { ok: false, message: 'Bad and good must be different commits' }
        }
        if (context.bisect?.active) {
          return { ok: false, message: 'A bisect is already in progress — reset it first' }
        }
        if (worktreeDirty) {
          return { ok: false, message: 'Worktree has changes — stash them before starting a bisect' }
        }
        try {
          const stdout = await bisectStart(git, badRef, goodRef)
          dispatch({ type: 'clearBisectPickMode' })
          dispatch({ type: 'pushView', value: 'bisect' })
          // Bisect start checks out the midpoint commit — HEAD moves,
          // history view needs the fresh row set.
          await refreshHistoryRows()
          await refreshContext({ silent: true })
          return {
            ok: true,
            message: extractBisectRemainingHint(stdout) || `Bisect started: bad ${badRef.slice(0, 8)} / good ${goodRef.slice(0, 8)}`,
          }
        } catch (error) {
          return { ok: false, message: `Bisect start failed: ${(error as Error).message}` }
        }
      },
      'checkout-file-from-stash': async () => {
        const path = payload?.trim()
        const ref = state.stashDiffRef
        if (!path) return { ok: false, message: 'No stash file under cursor' }
        if (!ref) return { ok: false, message: 'No stash ref active' }
        return checkoutFileFromStash(git, ref, path)
      },
      'cherry-pick-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return cherryPickCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'fixup-into-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        if ((context.worktree?.stagedCount ?? 0) === 0) {
          return { ok: false, message: 'Nothing staged to fix up — stage changes first (gs, then space/A).' }
        }
        const target = { hash: commit.hash, shortHash: commit.shortHash, message: commit.message }
        const result = await createFixupCommit(git, target)
        if (result.ok) {
          lastFixupTargetRef.current = target
        }
        return result
      },
      // #1350 — amend/reword were fully implemented (and tested) in
      // historyActions but reachable from nowhere. Both are HEAD-only,
      // so they resolve HEAD directly instead of the history cursor —
      // the entry points are compose (`a`) and the palette.
      'amend-head': async () => {
        if ((context.worktree?.stagedCount ?? 0) === 0) {
          return { ok: false, message: 'Nothing staged to amend — stage changes first (gs, then space/A).' }
        }
        const head = (await git.revparse(['HEAD'])).trim()
        const result = await amendHeadCommit(git, head)
        return result.ok
          ? {
            ...result,
            // Momentum hint: an amend rewrites the head commit, so a
            // previously-pushed branch now needs the with-lease force
            // (the P-push escalation offers it automatically).
            message: `${result.message} (${head.slice(0, 7)}) — P push may need force-with-lease`,
          }
          : result
      },
      'reword-head': async () => {
        const head = (await git.revparse(['HEAD'])).trim()
        if (payload?.trim()) {
          return rewordHeadCommit(git, head, payload)
        }
        // No message yet (palette entry) — open the prompt seeded with
        // the current subject; submission re-runs this workflow with
        // the typed message as payload.
        const subject = (await git.raw(['log', '-1', '--pretty=%s'])).trim()
        dispatch({
          type: 'openInputPrompt',
          kind: 'reword-head',
          label: `Reword HEAD (${head.slice(0, 7)}) — new commit message`,
          initial: subject,
        })
        return { ok: true, message: 'Reword HEAD — edit the message, enter to apply, esc cancels.' }
      },
      'execute-rebase-plan': async () => {
        const plan = state.rebasePlan
        if (!plan || plan.rows.length === 0) {
          return { ok: false, message: 'No rebase plan open — press i on a history commit first.' }
        }
        const result = await executeRebasePlan(git, plan.rows)
        if (result.ok) {
          // The plan is consumed; land back on the rewritten history.
          dispatch({ type: 'clearRebasePlan' })
          dispatch({ type: 'navigateHome' })
        }
        return result
      },
      'autosquash-rebase': async () => {
        // Prefer the recorded fixup target (the choice prompt carries no
        // payload); fall back to the cursored commit for the palette path.
        const recorded = lastFixupTargetRef.current
        const commit = recorded ?? (() => {
          const selected = getSelectedInkCommit(state)
          return selected
            ? { hash: selected.hash, shortHash: selected.shortHash, message: selected.message }
            : undefined
        })()
        const result = await autosquashRebase(git, commit ?? undefined)
        if (result.ok) {
          lastFixupTargetRef.current = null
        }
        return result
      },
      'revert-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return revertCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'reset-to-commit': async () => {
        // Mode arrives via the action's `payload` field — the 1-key
        // reset-mode choice (#1351) routes s/m/h here as
        // soft/mixed/hard. Default to `mixed` (git's own default) when
        // no payload arrives (palette path).
        const raw = payload?.trim().toLowerCase() || 'mixed'
        if (!isResetMode(raw)) {
          return { ok: false, message: `Unknown reset mode: ${raw}. Use soft, mixed, or hard.` }
        }
        // Reflog "time machine" (#0.67): when the reflog view is active the
        // target is the cursored reflog entry, not a history commit.
        if (state.activeView === 'reflog') {
          const entry = filteredReflogList[
            Math.min(state.selectedReflogIndex, Math.max(0, filteredReflogList.length - 1))
          ]
          if (!entry) return { ok: false, message: 'No reflog entry selected' }
          return resetToCommit(git, {
            hash: entry.hash,
            shortHash: entry.hash,
            message: entry.subject,
          }, raw as ResetMode)
        }
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return resetToCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        }, raw as ResetMode)
      },
      'interactive-rebase': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return startInteractiveRebase(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'create-branch-here': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Branch name required' }
        // Reflog "time machine" (#0.67): branch from the cursored reflog entry.
        if (state.activeView === 'reflog') {
          const entry = filteredReflogList[
            Math.min(state.selectedReflogIndex, Math.max(0, filteredReflogList.length - 1))
          ]
          if (!entry) return { ok: false, message: 'No reflog entry selected' }
          return createBranchFromCommit(git, name, { hash: entry.hash, shortHash: entry.hash })
        }
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return createBranchFromCommit(git, name, {
          hash: commit.hash,
          shortHash: commit.shortHash,
        })
      },
      'checkout-reflog-entry': async () => {
        const entry = filteredReflogList[
          Math.min(state.selectedReflogIndex, Math.max(0, filteredReflogList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No reflog entry selected' }
        return checkoutReflogEntry(git, entry)
      },
      // #1361 — global undo. Re-derives the plan from the RAW reflog
      // (not filteredReflogList — undo always targets the actual last
      // operation) rather than trusting whatever was resolved when `z`
      // was pressed, since the reflog can move between keystroke and
      // y-confirm.
      'global-undo': async () => {
        const plan = planReflogUndo(context.reflog?.entries || [])
        if (!plan) return { ok: false, message: 'No reflog entry to undo.' }
        return performReflogUndo(git, plan)
      },
      // Follow-up checkout after a successful create-branch-here (#1326).
      // Reached only via the in-runner setPendingConfirmation dispatch
      // (create-branch-here → y-confirm → here); the branch name rides in
      // `payload`. Using `git switch <name>` rather than checkoutBranch so
      // we don't need a full BranchRef — the branch was just created so we
      // know it's a plain local name.
      'checkout-created-branch': async () => {
        return checkoutBranchByName(git, payload ?? '')
      },
      // Recovery follow-up for a dirty-worktree checkout refusal (#1360).
      // Reached only via the dirty-checkout-recovery choice prompt below;
      // the target branch name rides in `payload`. Stashes EVERYTHING
      // (createStash passes `-u`, so untracked files ride along — they
      // can block a switch too) and retries the switch by name. The
      // stash is deliberately NOT auto-popped after the switch — the
      // success message points at the stash surface (gz) so the user
      // decides when (and on which branch) to bring the changes back.
      'stash-and-checkout-branch': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Branch name required' }
        const stashed = await createStash(git, `WIP before switching to ${name}`)
        if (!stashed.ok) {
          return { ok: false, message: `Stash failed — staying put: ${stashed.message}` }
        }
        const checkout = await checkoutBranchByName(git, name)
        return checkout.ok
          ? { ok: true, message: `Stashed changes and switched to ${name} — the stash is waiting on the stash surface (gz)` }
          : { ok: false, message: `Stashed changes, but the switch still failed: ${checkout.message}` }
      },
      // Recovery follow-up for a dirty-worktree `gh pr checkout` refusal
      // (#1430). Same shape as `stash-and-checkout-branch`, but the retry
      // target is a PR number (rides in `payload`) checked out via the
      // forge rather than a local branch name.
      'stash-and-checkout-pr': async () => {
        const prNumber = Number(payload)
        if (!payload || !Number.isInteger(prNumber) || prNumber <= 0) {
          return { ok: false, message: 'PR number required' }
        }
        const stashed = await createStash(git, `WIP before checking out PR #${prNumber}`)
        if (!stashed.ok) {
          return { ok: false, message: `Stash failed — staying put: ${stashed.message}` }
        }
        const checkout = await forge.checkoutPullRequestByNumber(prNumber)
        return checkout.ok
          ? { ok: true, message: `Stashed changes and checked out PR #${prNumber} — the stash is waiting on the stash surface (gz)` }
          : { ok: false, message: `Stashed changes, but the checkout still failed: ${checkout.message}` }
      },
      // #0.71 — submodule maintenance. Resolve the target from the
      // filtered list so the cursor index lines up with what's on screen
      // (a filtered-out submodule can never be the action target). The
      // post-handler refreshContext reloads the submodule overview so the
      // row's status flag updates after the action lands.
      'submodule-init': async () => {
        const entry = filteredSubmoduleList[
          Math.min(state.selectedSubmoduleIndex, Math.max(0, filteredSubmoduleList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No submodule selected' }
        return initSubmodule(git, entry)
      },
      'submodule-update': async () => {
        const entry = filteredSubmoduleList[
          Math.min(state.selectedSubmoduleIndex, Math.max(0, filteredSubmoduleList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No submodule selected' }
        return updateSubmodule(git, entry, { init: true })
      },
      'submodule-sync': async () => {
        const entry = filteredSubmoduleList[
          Math.min(state.selectedSubmoduleIndex, Math.max(0, filteredSubmoduleList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No submodule selected' }
        return syncSubmodule(git, entry)
      },
      // #0.71 — remote management. add parses a single `name url` line
      // from the prompt payload; set-url / remove / prune resolve the
      // target from the filtered list so the cursor index lines up with
      // what's on screen. The post-handler refreshContext reloads the
      // remote overview so the list reflects the change.
      'remote-add': async () => {
        const raw = (payload || '').trim()
        if (!raw) return { ok: false, message: 'Remote name and URL required' }
        // Single-line `name url` prompt: first whitespace-run splits the
        // name from the URL. A missing URL falls through to the action's
        // own validation, which returns a friendly error.
        const firstSpace = raw.search(/\s/)
        const name = firstSpace === -1 ? raw : raw.slice(0, firstSpace)
        const url = firstSpace === -1 ? '' : raw.slice(firstSpace).trim()
        return addRemote(git, name, url)
      },
      'remote-set-url': async () => {
        const entry = filteredRemoteList[
          Math.min(state.selectedRemoteIndex, Math.max(0, filteredRemoteList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No remote selected' }
        const url = (payload || '').trim()
        return setRemoteUrl(git, entry.name, url)
      },
      'remote-remove': async () => {
        const entry = filteredRemoteList[
          Math.min(state.selectedRemoteIndex, Math.max(0, filteredRemoteList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No remote selected' }
        return removeRemote(git, entry.name)
      },
      'remote-prune': async () => {
        const entry = filteredRemoteList[
          Math.min(state.selectedRemoteIndex, Math.max(0, filteredRemoteList.length - 1))
        ]
        if (!entry) return { ok: false, message: 'No remote selected' }
        return pruneRemote(git, entry.name)
      },
      'create-tag-here': async () => {
        const commit = getSelectedInkCommit(state)
        const name = payload?.trim()
        if (!commit) return { ok: false, message: 'No commit selected' }
        if (!name) return { ok: false, message: 'Tag name required' }
        return createTagAtCommit(git, name, {
          hash: commit.hash,
          shortHash: commit.shortHash,
        })
      },
      'checkout-file-from-commit': async () => {
        // payload is "<sha> <path>" so we pass both through a single
        // string field on the action.
        const trimmed = payload?.trim()
        if (!trimmed) return { ok: false, message: 'No commit file under cursor' }
        const spaceIndex = trimmed.indexOf(' ')
        if (spaceIndex < 0) return { ok: false, message: 'Malformed commit file payload' }
        const sha = trimmed.slice(0, spaceIndex)
        const path = trimmed.slice(spaceIndex + 1)
        if (!sha || !path) return { ok: false, message: 'No commit file under cursor' }
        return checkoutFileFromCommit(git, sha, path)
      },
      'apply-hunk-worktree': async () => runApplyHunk('worktree', payload),
      'apply-hunk-index': async () => runApplyHunk('index', payload),
      'remove-worktree': async () => {
        // #1452 — resolves via the selector, which falls back to the
        // cursor against the unfiltered list when the action is invoked
        // from the palette with a filter active that hides every worktree.
        const cursorTarget = getSelectedWorktree(state, context)
        if (!cursorTarget) return { ok: false, message: 'No worktree selected' }
        if (cursorTarget.current) {
          return {
            ok: false,
            message: 'Cannot remove the current worktree — switch to another worktree first.',
          }
        }
        return removeWorktree(git, cursorTarget)
      },
      'remove-worktree-and-branch': async () => {
        const cursorTarget = getSelectedWorktree(state, context)
        if (!cursorTarget) return { ok: false, message: 'No worktree selected' }
        if (cursorTarget.current) {
          return {
            ok: false,
            message: 'Cannot remove the current worktree — switch to another worktree first.',
          }
        }
        // The chained helper handles the worktree removal AND the
        // safe branch delete in one call. Branch refs come from the
        // live context so the underlying deleteBranch helper sees
        // the current/local flags it needs to refuse the destructive
        // path on the wrong target.
        return removeWorktreeAndBranch(
          git,
          cursorTarget,
          context.branches?.localBranches || []
        )
      },
      // Worktree-checkout-conflict resolutions (#1175). Unlike the
      // cursor-targeted handlers above, these act on the worktree
      // captured in `state.worktreeCheckoutConflict` (the one git named
      // when it refused the checkout), not the worktrees-view cursor.
      'conflict-remove-worktree-checkout': async () => {
        const conflict = state.worktreeCheckoutConflict
        dispatch({ type: 'setWorktreeCheckoutConflict', value: undefined })
        if (!conflict) return { ok: false, message: 'No worktree conflict to resolve.' }
        const worktree = context.worktreeList?.worktrees?.find((w) => w.path === conflict.worktreePath)
        if (!worktree) return { ok: false, message: `Worktree ${conflict.worktreePath} not found.` }
        // removeWorktree refuses a dirty / current worktree and returns
        // a clear message — surface it rather than forcing.
        const removed = await removeWorktree(git, worktree)
        if (!removed.ok) return removed
        const branch = (context.branches?.localBranches || []).find(
          (b) => b.type === 'local' && b.shortName === conflict.branch
        )
        if (!branch) {
          return { ok: true, message: `Removed worktree ${worktree.path}; branch ${conflict.branch} not found to check out.` }
        }
        const checkout = await checkoutBranch(git, branch)
        return checkout.ok
          ? { ok: true, message: `Removed worktree ${worktree.path} and checked out ${conflict.branch}` }
          : { ok: false, message: `Removed worktree ${worktree.path}, but checkout failed: ${checkout.message}` }
      },
      'conflict-remove-worktree-branch': async () => {
        const conflict = state.worktreeCheckoutConflict
        dispatch({ type: 'setWorktreeCheckoutConflict', value: undefined })
        if (!conflict) return { ok: false, message: 'No worktree conflict to resolve.' }
        const worktree = context.worktreeList?.worktrees?.find((w) => w.path === conflict.worktreePath)
        if (!worktree) return { ok: false, message: `Worktree ${conflict.worktreePath} not found.` }
        return removeWorktreeAndBranch(git, worktree, context.branches?.localBranches || [])
      },
      'abort-operation': async () => {
        const operation = context.operation?.operation
        if (!operation) {
          return { ok: false, message: 'No git operation in progress' }
        }
        return abortOperation(git, operation)
      },
      // Intent-based: `U` promises "keep your branch's version" and `u`
      // "keep the incoming changes". The resolvers pick --ours/--theirs
      // per operation type because rebase swaps git's sides (HEAD is the
      // upstream during a rebase replay).
      'resolve-conflict-ours': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return resolveConflictKeepCurrentBranch(git, context.operation?.operation ?? 'none', path)
      },
      'resolve-conflict-theirs': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return resolveConflictKeepIncoming(git, context.operation?.operation ?? 'none', path)
      },
      'resolve-conflict-stage': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return stageConflictResolved(git, path)
      },
      'resolve-conflict-open-diff': async () => {
        // Push the diff view for the conflicted file so the user can
        // inspect conflict markers in context. We find the file's index
        // in the worktree file list and navigate to its diff.
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        const worktreeFiles = context.worktree?.files || []
        const fileIndex = worktreeFiles.findIndex((f) => f.path === path)
        if (fileIndex >= 0) {
          dispatch({ type: 'navigateOpenDiffForWorktreeFile', fileIndex })
          return { ok: true, message: `Viewing diff for ${path}` }
        }
        // File not in worktree list (e.g. deleted-by-us) — open in
        // editor as fallback so the user can still inspect it.
        return { ok: true, message: `${path} not in worktree diff list` }
      },
      'continue-operation': async () => {
        const operation = context.operation?.operation
        if (!operation || operation === 'none') {
          return { ok: false, message: 'No git operation in progress' }
        }
        if ((context.operation?.conflictedFiles.length ?? 0) > 0) {
          return { ok: false, message: 'Resolve all conflicts before continuing' }
        }
        return continueOperation(git, operation)
      },
      'open-pr': async () => {
        const repo = context.provider?.repository
        // Any detected forge works here: buildProviderUrl emits the correct
        // GitHub or GitLab web URLs. Only reject genuinely unsupported remotes.
        if (!repo || repo.provider === 'unsupported' || !repo.owner || !repo.name) {
          return { ok: false, message: 'No supported forge remote detected for this repo' }
        }
        // History view: prefer the cursored commit's URL so `O` from
        // a commit context lands the user on the commit page rather
        // than the repo root or the current PR. The user-visible
        // intent of `O` is "open whatever I'm cursoring on the web";
        // a commit is what the cursor is on in the history view.
        if (state.activeView === 'history') {
          const commit = getSelectedInkCommit(state)
          if (commit) {
            return openProviderUrl(repo, { type: 'commit', commit: commit.hash })
          }
        }
        const pr = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
        if (pr) {
          return openProviderUrl(repo, { type: 'pull-request', number: pr.number })
        }
        // No PR — fall back to opening the repo page so the user can
        // create one or browse from there.
        return openProviderUrl(repo, { type: 'repo' })
      },
      'fetch-remotes': async () => fetchRemotes(git),
      'pull-current-branch': async () => pullCurrentBranch(git),
      'push-current-branch': async () => pushCurrentBranch(git),
      // Per-branch fetch / pull / push that operate on the cursored
      // row in the branches sidebar. inkInput.ts dispatches these
      // when F / U / P fire from the sidebar; the *-current-branch
      // / fetch-remotes variants above still handle the same keys
      // from any other context.
      'fetch-selected-branch': async () => {
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return fetchBranch(git, branch)
      },
      'pull-selected-branch': async () => {
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pullBranch(git, branch, context.branches?.currentBranch)
      },
      'push-selected-branch': async () => {
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pushBranch(git, branch)
      },
      'force-push-current-branch': async () => forcePushCurrentBranch(git),
      'force-push-selected-branch': async () => {
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return forcePushBranch(git, branch)
      },
      'pull-rebase-current': async () => pullCurrentBranchRebase(git),
      'pull-merge-current': async () => pullCurrentBranchMerge(git),
      'add-to-gitignore': async () => addToGitignore(git, payload || ''),
      'rename-branch': async () => {
        const newName = payload?.trim()
        if (!newName) return { ok: false, message: 'New branch name required' }
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return renameBranch(git, branch.shortName, newName)
      },
      'set-upstream': async () => {
        const upstream = payload?.trim()
        if (!upstream) return { ok: false, message: 'Upstream ref required' }
        const branch = getSelectedBranch(state, context)
        if (!branch) return { ok: false, message: 'No branch selected' }
        return setUpstream(git, branch.shortName, upstream)
      },
      'delete-remote-tag': async () => {
        const tag = getSelectedTag(state, context)
        if (!tag) return { ok: false, message: 'No tag selected' }
        return deleteRemoteTag(git, tag.name)
      },
      'create-stash': async () => {
        // Empty is allowed — createStash turns it into a quick WIP stash
        // (git's own `WIP on <branch>` subject). Naming is optional.
        return createStash(git, payload ?? '')
      },
      'stash-staged': async () => createStash(git, payload ?? '', { stagedOnly: true }),
      'stash-keep-index': async () => createStash(git, payload ?? '', { keepIndex: true }),
      // #783 — full PR action panel handlers. Each wraps the matching
      // pullRequestActions verb. Strategy / body arrives via `payload`
      // — input prompts validate before they reach here, but the
      // strategy guard stays as a defensive belt-and-suspenders since
      // a future palette path could call us with a raw value.
      'create-pr': async () => {
        // The input-prompt submit handler validates non-empty title
        // already; this is the defensive belt-and-suspenders for
        // future palette callers passing in a raw payload.
        const nouns = forgeNouns(forgeProvider)
        const text = (payload || '').trim()
        if (!text) {
          return { ok: false, message: `${nouns.singular} title is required (first line of the prompt).` }
        }
        const lines = text.split('\n')
        const title = lines[0].trim()
        if (!title) {
          return { ok: false, message: `${nouns.singular} title cannot be blank.` }
        }
        // Body: lines 2+, with the leading blank line tolerated. Empty
        // body is allowed — the forge renders an empty body fine.
        const body = lines.slice(1).join('\n').replace(/^\n+/, '').trimEnd()
        const head = context.branches?.currentBranch || context.provider?.currentBranch
        const base = context.provider?.repository.defaultBranch
        if (!head) {
          return { ok: false, message: 'No current branch detected.' }
        }
        if (!base) {
          return { ok: false, message: `No default branch detected. Configure the ${nouns.name} remote.` }
        }
        return forge.createPullRequest({ base, head, title, body })
      },
      'merge-pr': async () => {
        const strategy = (payload || 'merge').toLowerCase()
        if (!isPullRequestMergeStrategy(strategy)) {
          return { ok: false, message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.` }
        }
        return forge.mergePullRequest(strategy)
      },
      'close-pr': async () => forge.closePullRequest(),
      'approve-pr': async () => forge.approvePullRequest(),
      'request-changes-pr': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Review body required for change-request' }
        return forge.requestChangesPullRequest(body)
      },
      'comment-pr': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        return forge.commentPullRequest(body)
      },
      // #882 phase 4 — triage-view low-risk mutations. Each picks
      // the cursored item from the *filtered* list (matching what
      // the user sees on screen), runs the corresponding `gh` action,
      // and on success clears both the in-memory context entry and
      // the disk cache so the next view entry refetches. Comment
      // is additive; label / assign are toggleable via re-invocation
      // with --remove-* (deferred to phase 5 as part of the y-confirm
      // suite). Open / yank don't mutate so they skip the
      // invalidation step entirely.
      'triage-issue-open': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        try {
          await defaultOpenUrlRunner(issue.url)
          return { ok: true, message: `Opened ${issue.url}` }
        } catch (error) {
          return { ok: false, message: (error as Error).message }
        }
      },
      'triage-issue-comment': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await forge.commentIssue(issue.number, body)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-label': async () => {
        const label = payload?.trim()
        if (!label) return { ok: false, message: 'Label name required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await forge.addIssueLabel(issue.number, label)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-assign': async () => {
        const assignee = payload?.trim()
        if (!assignee) return { ok: false, message: 'Assignee login required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await forge.addIssueAssignee(issue.number, assignee)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-pr-open': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        try {
          await defaultOpenUrlRunner(pr.url)
          return { ok: true, message: `Opened ${pr.url}` }
        } catch (error) {
          return { ok: false, message: (error as Error).message }
        }
      },
      'triage-pr-comment': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.commentPullRequestByNumber(pr.number, body)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-label': async () => {
        const label = payload?.trim()
        if (!label) return { ok: false, message: 'Label name required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.addPullRequestLabel(pr.number, label)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-assign': async () => {
        const assignee = payload?.trim()
        if (!assignee) return { ok: false, message: 'Assignee login required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.addPullRequestAssignee(pr.number, assignee)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      // #882 phase 5 — destructive triage mutations. Each is gated
      // through the y-confirm path so the user sees a prompt before
      // anything ships. The runner reads the cursored item from the
      // filtered list at confirm-time; the cursor can't move while
      // the confirmation overlay is up so there's no stale-target
      // window. Cache invalidation matches the phase-4 pattern.
      'triage-issue-close': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await forge.closeIssue(issue.number)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-reopen': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await forge.reopenIssue(issue.number)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-pr-merge': async () => {
        const strategy = payload?.trim()
        if (!strategy || !isPullRequestMergeStrategy(strategy)) {
          return {
            ok: false,
            message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.`,
          }
        }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.mergePullRequestByNumber(pr.number, strategy)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-close': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.closePullRequestByNumber(pr.number)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-approve': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.approvePullRequestByNumber(pr.number)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-request-changes': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Review body required for change-request' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await forge.requestChangesPullRequestByNumber(pr.number, body)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      // #1363 — `gh pr checkout <n>` for the cursored triage row. The
      // only triage verb that mutates LOCAL state (HEAD moves), so it
      // skips the list-cache invalidation (the PR itself is untouched)
      // and instead rides the checkout follow-ups below: history
      // refresh + cursor snap + silent context refresh, exactly like
      // `checkout-branch`.
      'triage-pr-checkout': async () => {
        // The PR-diff `C` path carries the viewed PR's number as the
        // payload (the triage cursor could drift if the list refetched
        // under the open diff); the triage-list `C` path omits it and
        // targets the cursored row.
        const payloadNumber = Number(payload)
        if (payload && Number.isInteger(payloadNumber) && payloadNumber > 0) {
          return forge.checkoutPullRequestByNumber(payloadNumber)
        }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        return forge.checkoutPullRequestByNumber(pr.number)
      },
      // Status surface group-level batch ops (#791 follow-up). The
      // input handler dispatches these when the user presses Enter on a
      // group header. We re-derive the file list from the live
      // `context.worktree?.files` rather than trusting a snapshot —
      // the worktree may have changed since the keystroke fired (rare,
      // but the cost of re-filtering is negligible compared to the cost
      // of a stale add). The mask is honored too so a user who's
      // hidden a category never has it touched by accident.
      'stage-all-unstaged': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'unstaged')
        return stageAllFiles(git, files)
      },
      'unstage-all-staged': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'staged')
        return unstageAllFiles(git, files)
      },
      'stage-all-untracked': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'untracked')
        return stageAllFiles(git, files)
      },
      'stage-all': async () => stageAll(git),
      'stage-pathspec': async () => stagePathspec(git, payload || ''),
    }
    const handler = handlers[id]
    if (!handler) {
      dispatch({ type: 'setStatus', value: `Workflow action ${id} not yet wired`, kind: 'warning' })
      return
    }
    // Remote network ops (fetch / pull / push) get a full-screen
    // history loader while in flight so the commit list doesn't sit
    // frozen and then abruptly repaint when the call returns. Cleared
    // in `finally` *after* the post-op refresh below so the loader
    // hands straight off to the freshly-fetched rows instead of
    // flashing the stale list for a frame in between.
    const remoteOp = REMOTE_OP_LOADERS[id]
    let remoteOpClaim = 0
    if (remoteOp) {
      remoteOpClaim = ++remoteOpClaimRef.current
      dispatch({ type: 'setRemoteOp', value: remoteOp })
    }
    // Mark the cursored row as busy so it shows an inline pending
    // spinner while the git call runs (delete or checkout). Cleared in
    // `finally` after the refresh, so a successful delete hands straight
    // off to the row vanishing, a checkout to the sidebar repainting
    // with the new current branch, and a failure (e.g. an unmerged
    // branch) restores the row's normal icon alongside the error status.
    const pendingItemAction = resolvePendingItemAction(id, state, context)
    let pendingItemActionClaim = 0
    if (pendingItemAction) {
      pendingItemActionClaim = ++pendingItemActionClaimRef.current
      dispatch({ type: 'setPendingItemAction', value: pendingItemAction })
    }
    try {
    const result = await handler()
    // #1429 — a recovery prompt raised below resolves `git` from the
    // frame that was ACTIVE when the user answers it, not the one that
    // issued the call. If the user drilled into (or popped out of) a
    // repo frame while this awaited, re-targeting the prompt would act
    // on the wrong repo (or a destructive option would fire against it
    // silently). Read `depsRef.current` fresh — the destructured
    // `runtimes` above is a stale pre-await snapshot — same trick
    // `app.ts`'s `repoFrameDepthRef` already relies on for the sibling
    // #1384 cases. Drop the prompt rather than re-target it.
    const frameChanged = depsRef.current.runtimes.length - 1 !== issuedAtDepth
    // #1349 — color the shared result dispatch by OUTCOME. Before this,
    // a failed cherry-pick and a successful push both rendered as the
    // blue ℹ info style; the status system already distinguishes
    // success (green ✓, auto-dismisses) from error (red ✗, sticky).
    // Handlers that return no result (pure-navigation ones) keep the
    // neutral info treatment. Recovery escalations below may follow up
    // with their own prompt/warning on top of the error status.
    // Momentum hint (#1355): after a history rewrite lands, advertise
    // the reflog time machine AT the moment it matters — recovery
    // exists but was never surfaced when the user might want it.
    const historyRewriteHint =
      result?.ok && isHistoryRewriteWorkflow(id) ? ' · gr reflog to recover' : ''
    dispatch({
      type: 'setStatus',
      value: `${result?.message || 'Workflow action complete'}${historyRewriteHint}`,
      kind: result ? (result.ok ? 'success' : 'error') : undefined,
    })
    // #1361 — batch delete selection lifecycle. A successful delete
    // consumed the selection; clear it so leftover marks can't re-aim a
    // later D. On failure, FREEZE the attempted target set into explicit
    // marks (replacing any positional v-range): the deleted branches
    // won't resolve after the refresh below, so the surviving marks are
    // exactly the refused ones — which makes the force-delete escalation
    // re-target precisely them instead of re-resolving a range against
    // the shrunken list.
    if (id === 'delete-branch' || id === 'force-delete-branch') {
      if (result?.ok) {
        dispatch({ type: 'clearSelection' })
      } else if (pendingItemAction && pendingItemAction.ids.length > 1) {
        dispatch({ type: 'setMarks', view: 'branches', ids: pendingItemAction.ids })
      }
    }
    // #1361 — same batch selection lifecycle for drop-stash. No force
    // escalation exists for stash drops (unlike delete-branch's -d/-D),
    // so a partial failure just leaves the refused stashes marked for
    // the user to inspect or retry.
    if (id === 'drop-stash') {
      if (result?.ok) {
        dispatch({ type: 'clearSelection' })
      } else if (pendingItemAction && pendingItemAction.ids.length > 1) {
        dispatch({ type: 'setMarks', view: 'stash', ids: pendingItemAction.ids })
      }
    }
    // A safe `delete-branch` (`git branch -d`) refuses branches that
    // aren't fully merged. Rather than dead-end on git's raw error, raise
    // a second y-confirm offering the force-delete (`git branch -D`). The
    // cursor hasn't moved (the delete failed), so the force handler
    // re-resolves the same branch. Batch refusals carry each branch's
    // raw git message in `details`, so the not-fully-merged detection
    // scans those too.
    const deleteFailureText = [result?.message, ...((result as { details?: string[] } | undefined)?.details || [])].join('\n')
    if (id === 'delete-branch' && !result?.ok && isBranchNotFullyMergedError(deleteFailureText)) {
      dispatch({ type: 'setPendingConfirmation', value: 'force-delete-branch' })
    }
    // After a successful create-branch-here, offer to switch onto the
    // newly created branch. The branch name travels in `payload` (the
    // same value passed to createBranchFromCommit). This matches the
    // desired behavior for #1326: `git branch <name> <sha>` stays put,
    // so the user gets a Y/n confirm to switch.
    if (id === 'create-branch-here' && result?.ok) {
      const branchName = payload?.trim()
      if (branchName) {
        dispatch({
          type: 'setPendingConfirmation',
          value: 'checkout-created-branch',
          payload: branchName,
        })
      }
    }
    // After a successful create-branch (Branches surface `+`), offer to
    // switch onto the newly created branch. createBranch now uses
    // `git branch` (no auto-checkout) so the prompt matches the
    // create-branch-here behavior (#1326).
    if (id === 'create-branch' && result?.ok) {
      const branchName = payload?.trim()
      if (branchName) {
        dispatch({
          type: 'setPendingConfirmation',
          value: 'checkout-created-branch',
          payload: branchName,
        })
      }
    }
    // #1356 — a push rejected non-fast-forward (post-amend/rebase) gets
    // a with-lease force offer instead of a dead-end. The y-confirm
    // carries its own warning copy; --force-with-lease still refuses if
    // the remote moved since the last fetch.
    if (
      (id === 'push-current-branch' || id === 'push-selected-branch') &&
      !result?.ok &&
      isNonFastForwardPushError([result?.message, ...((result as { details?: string[] } | undefined)?.details || [])].join('\n'))
    ) {
      dispatch({
        type: 'setPendingConfirmation',
        value: id === 'push-current-branch' ? 'force-push-current-branch' : 'force-push-selected-branch',
      })
    }
    // #1356 — a diverged `pull --ff-only` offers the rebase/merge
    // recovery choice instead of git's raw refusal. Only fires for the
    // CURRENT branch (the predicate excludes the fetch-refspec rejection
    // non-current pulls produce — rebase/merge don't apply there).
    if (
      (id === 'pull-current-branch' || id === 'pull-selected-branch') &&
      !result?.ok &&
      isDivergedPullError([result?.message, ...((result as { details?: string[] } | undefined)?.details || [])].join('\n')) &&
      !frameChanged
    ) {
      dispatch({
        type: 'setPendingChoice',
        value: {
          id: 'diverged-pull-recovery',
          title: 'Local and remote have diverged',
          warning: 'A fast-forward pull is not possible. Choose how to reconcile.',
          options: [
            { key: 'r', label: 'Pull with rebase (replay local commits on top)', workflowId: 'pull-rebase-current' },
            { key: 'm', label: 'Pull with merge (create a merge commit)', workflowId: 'pull-merge-current' },
          ],
        },
      })
    }
    // A branch checked out in a worktree can't be deleted — and unlike
    // the unmerged case, `git branch -D` won't force it either, so we
    // don't offer a confirmation. Replace git's raw rejection with a
    // clear "free up the worktree first" message that names where the
    // branch is still in use.
    if (
      (id === 'delete-branch' || id === 'force-delete-branch') &&
      !result?.ok &&
      isBranchCheckedOutElsewhereError(result?.message)
    ) {
      const worktreePath = parseCheckedOutWorktreePath(result?.message)
      const branchName = pendingItemAction?.ids[0]
      dispatch({
        type: 'setStatus',
        value: worktreePath
          ? `Can't delete ${branchName ? `'${branchName}'` : 'branch'} — checked out in worktree ${worktreePath}. Switch that worktree off the branch or remove it first.`
          : `Can't delete ${branchName ? `'${branchName}'` : 'branch'} — it's checked out in another worktree. Switch that worktree off the branch or remove it first.`,
        kind: 'warning',
      })
    }
    // Checking out a branch that's already checked out in another
    // worktree is rejected by git ("already checked out at <path>").
    // Rather than dead-end on that, capture the conflict and raise a
    // multi-option prompt: switch into that worktree, remove it and
    // check out here, or remove it and delete the branch (#1175, #1181).
    // #1357 — after a successful fixup, offer to fold it in right away.
    // Declining leaves the fixup! commit for a later autosquash (hinted
    // in the success message).
    if (id === 'fixup-into-commit' && result?.ok && lastFixupTargetRef.current && !frameChanged) {
      const target = lastFixupTargetRef.current
      dispatch({
        type: 'setPendingChoice',
        value: {
          id: 'fixup-autosquash-offer',
          title: `Squash fixups into ${target.shortHash} now?`,
          warning: 'Runs git rebase --autosquash (rewrites history). Esc keeps the fixup commit for later.',
          options: [
            { key: 's', label: 'Squash now (rebase --autosquash)', workflowId: 'autosquash-rebase', destructive: true },
          ],
        },
      })
    }
    if (id === 'checkout-branch' && !result?.ok && isBranchCheckedOutElsewhereError(result?.message)) {
      const worktreePath = parseCheckedOutWorktreePath(result?.message)
      const branchName = pendingItemAction?.ids[0]
      if (worktreePath && branchName && frameChanged) {
        // #1429 — the frame changed mid-await; dropping silently here (no
        // fallback dispatch) matches the other recovery-prompt guards below.
      } else if (worktreePath && branchName) {
        const worktree = context.worktreeList?.worktrees?.find((w) => w.path === worktreePath)
        const dirty = worktree?.dirty ?? false
        dispatch({
          type: 'setWorktreeCheckoutConflict',
          value: { branch: branchName, worktreePath, dirty },
        })
        dispatch({
          type: 'setPendingChoice',
          value: {
            id: 'worktree-checkout-conflict',
            title: `'${branchName}' is checked out in another worktree`,
            warning: `Checked out at ${worktreePath}.${dirty ? ' That worktree has uncommitted changes — removal will be refused until it is clean or stashed.' : ''}`,
            options: [
              { key: 's', label: 'Switch to that worktree', intent: 'switch-worktree' },
              { key: 'r', label: 'Remove worktree & check out here', workflowId: 'conflict-remove-worktree-checkout', destructive: true },
              { key: 'x', label: 'Remove worktree & delete branch', workflowId: 'conflict-remove-worktree-branch', destructive: true },
            ],
          },
        })
      } else {
        dispatch({
          type: 'setStatus',
          value: `'${branchName ?? 'branch'}' is already checked out in another worktree.`,
          kind: 'warning',
        })
      }
    }
    // #1360 — `git switch` on a dirty tree dead-ends with git's raw
    // "would be overwritten" refusal. Offer stash & switch instead:
    // `s` stashes everything (untracked included) and retries the
    // checkout; Esc keeps the changes (and the current branch) in
    // place. The cursor hasn't moved (the checkout failed), so the
    // branch name captured for the row spinner is the retry target.
    // #1430 — the identical refusal also dead-ends the post-create-branch
    // switch (`checkout-created-branch`) and `gh pr checkout`
    // (`triage-pr-checkout`). Those two carry their retry identity
    // differently: `checkout-created-branch` has no `resolvePendingItemAction`
    // case, so the branch name rides in `payload` instead; `triage-pr-checkout`
    // resolves a PR NUMBER (from `payload` when invoked off the PR-diff view,
    // else the cursored triage row) and retries via a dedicated
    // `stash-and-checkout-pr` handler.
    if (
      (id === 'checkout-branch' || id === 'checkout-created-branch' || id === 'triage-pr-checkout') &&
      !result?.ok &&
      isDirtyWorktreeCheckoutError([result?.message, ...((result as { details?: string[] } | undefined)?.details || [])].join('\n')) &&
      !frameChanged
    ) {
      if (id === 'triage-pr-checkout') {
        const prNumber = payload?.trim() || pendingItemAction?.ids[0]
        if (prNumber) {
          dispatch({
            type: 'setPendingChoice',
            value: {
              id: 'dirty-checkout-recovery',
              title: `Uncommitted changes block checking out PR #${prNumber}`,
              warning: 'Stash & switch stashes everything (including untracked files), then retries the checkout. The stash stays put for you to pop later.',
              options: [
                { key: 's', label: 'Stash changes & switch', workflowId: 'stash-and-checkout-pr', payload: prNumber },
              ],
            },
          })
        }
      } else {
        const branchName = id === 'checkout-created-branch' ? payload?.trim() : pendingItemAction?.ids[0]
        if (branchName) {
          dispatch({
            type: 'setPendingChoice',
            value: {
              id: 'dirty-checkout-recovery',
              title: `Uncommitted changes block switching to '${branchName}'`,
              warning: 'Stash & switch stashes everything (including untracked files), then retries the checkout. The stash stays put for you to pop later.',
              options: [
                { key: 's', label: 'Stash changes & switch', workflowId: 'stash-and-checkout-branch', payload: branchName },
              ],
            },
          })
        }
      }
    }
    // #1360 — a cherry-pick / revert / rebase / pull that stopped on
    // CONFLICTS used to dump git's stderr on the status line and leave
    // the user to find `gx` on their own. Detect the conflict outcome
    // and offer the two moves that matter at that moment: open the
    // conflicts view, or abort the operation to unwind. Esc dismisses
    // the prompt but keeps the raw error status visible underneath
    // (`keepStatusOnDismiss`) — the repo really is mid-operation.
    // #1430 — `autosquash-rebase` runs a real rebase and can stop on
    // conflicts the same way `rebase-onto-branch`/`interactive-rebase` can.
    const conflictRecoveryTitles: Record<string, string> = {
      'cherry-pick-commit': 'Cherry-pick stopped on conflicts',
      'revert-commit': 'Revert stopped on conflicts',
      'rebase-onto-branch': 'Rebase stopped on conflicts',
      'interactive-rebase': 'Rebase stopped on conflicts',
      'execute-rebase-plan': 'Rebase stopped on conflicts',
      'autosquash-rebase': 'Rebase stopped on conflicts',
      'pull-current-branch': 'Pull stopped on conflicts',
      'pull-selected-branch': 'Pull stopped on conflicts',
      'pull-rebase-current': 'Pull stopped on conflicts',
      'pull-merge-current': 'Pull stopped on conflicts',
    }
    // `continue-operation` covers merge/rebase/cherry-pick/revert, so its
    // title can't be a static string like the siblings above — it stops on
    // a FURTHER conflict mid-sequence, and the operation type in progress
    // is known via `context.operation?.operation`.
    const continueOperationTitles: Record<string, string> = {
      merge: 'Merge stopped on conflicts',
      rebase: 'Rebase stopped on conflicts',
      'cherry-pick': 'Cherry-pick stopped on conflicts',
      revert: 'Revert stopped on conflicts',
    }
    const conflictRecoveryTitle =
      id === 'continue-operation'
        ? continueOperationTitles[context.operation?.operation ?? '']
        : conflictRecoveryTitles[id]
    if (
      conflictRecoveryTitle &&
      !result?.ok &&
      isOperationConflictError([result?.message, ...((result as { details?: string[] } | undefined)?.details || [])].join('\n')) &&
      !frameChanged
    ) {
      dispatch({
        type: 'setPendingChoice',
        value: {
          id: 'operation-conflict-recovery',
          title: conflictRecoveryTitle,
          warning: 'The repository is mid-operation. Resolve the conflicts and continue, or abort to unwind.',
          keepStatusOnDismiss: true,
          options: [
            { key: 'x', label: 'Open conflicts view', intent: 'open-conflicts' },
            { key: 'a', label: 'Abort the operation', workflowId: 'abort-operation', destructive: true },
          ],
        },
      })
    }
    // Refresh history rows AS WELL when the workflow could have
    // changed the commits the user sees (#945 follow-up). The
    // workflow IDs below all either create/rewrite local commits or
    // change which branch's history is being viewed — without this
    // the history pane shows stale data even after the operation
    // succeeds. Cheap one-off `git log` call; doesn't fire on
    // metadata-only mutations (delete-tag, set-upstream, etc.).
    if (result?.ok && HISTORY_MUTATING_WORKFLOW_IDS.has(id)) {
      await refreshHistoryRows()
    }

    // Checkout-branch snaps the cursor to position 0 first so when the
    // refresh completes and the new current branch lands at the top
    // (per #809's pin-current rule), the cursor is already there
    // waiting. The refresh is *silent*: the loud refresh used to blank
    // every branch name behind a "loading branches…" placeholder (#806),
    // but the in-flight row now carries its own inline pending spinner
    // (resolvePendingItemAction → action 'checkout'), so a silent
    // stale-while-revalidate swap keeps the list readable and just
    // repaints the current-branch marker once the new context lands.
    if ((id === 'checkout-branch' || id === 'conflict-remove-worktree-checkout' || id === 'checkout-created-branch' || id === 'triage-pr-checkout' || id === 'stash-and-checkout-branch' || id === 'stash-and-checkout-pr') && result?.ok) {
      dispatch({ type: 'resetBranchSelection' })
      await refreshContext({ silent: true })
    } else {
      // Silent refresh so the deleted item disappears from the list
      // without flickering the surfaces through a 'loading' phase.
      await refreshContext({ silent: true })
    }

    // Stash workflow follow-up. Two distinct behaviours.
    //
    // **apply / pop**: the user brought stashed content back into the
    // worktree, but the sidebar still has them on the stash view.
    // Expected next move is "look at what landed in my worktree", so
    // jump them to history view (where the worktree counts in the
    // sidebar are visible) AND refresh worktree context explicitly so
    // the staged / unstaged / untracked numbers reflect the changes.
    //
    // **drop**: the silent context refresh above already re-fetched
    // the stash list, BUT users reported it feeling like nothing
    // happened. Fix two things: refresh worktree alongside (drops can
    // affect untracked files when the stash held `-u` state), and
    // surface the new stash count on the status line so there's
    // unambiguous feedback that the drop landed and the list shrank.
    if (result?.ok && (id === 'apply-stash' || id === 'pop-stash')) {
      dispatch({ type: 'pushView', value: 'history' })
      await refreshWorktreeContext()
    }
    // Refresh the worktree so a now-ignored untracked file drops out of
    // the status list immediately (the silent context refresh above
    // doesn't always re-read the worktree file set).
    if (result?.ok && id === 'add-to-gitignore') {
      await refreshWorktreeContext()
    }
    // Stage-all / stage-pathspec change staged/unstaged counts — refresh
    // the worktree so the status list + compose summary reflect it.
    if (result?.ok && (id === 'stage-all' || id === 'stage-pathspec')) {
      await refreshWorktreeContext()
    }
    // Stash & switch (#1360) empties the worktree into a stash — refresh
    // so the staged/unstaged/untracked counts drop to zero immediately.
    // #1430 — same for the PR variant.
    if (result?.ok && (id === 'stash-and-checkout-branch' || id === 'stash-and-checkout-pr')) {
      await refreshWorktreeContext()
    }
    if (result?.ok && id === 'drop-stash') {
      // Explicit worktree refresh in case the dropped stash carried
      // untracked-file state that's now collected.
      await refreshWorktreeContext()
      // The silent context refresh already replaced `context.stashes`;
      // reading the count back here would be stale because closures
      // capture the pre-refresh value. Status message stays generic
      // ("Dropped stash@{N}") — the visible list shrinking is the
      // unambiguous signal that the operation landed.
    }
    } catch (error) {
      // Defense-in-depth: today every action resolves to a result object
      // (failures are carried in `result.ok` / `result.message`, not
      // thrown), so this arm shouldn't fire. If a handler or a refresh
      // ever rejects, surface a clean error status instead of an
      // unhandled rejection — and let `finally` still clear the loaders.
      dispatch({
        type: 'setStatus',
        value: error instanceof Error ? error.message : String(error),
        kind: 'error',
      })
    } finally {
      // Always clear the loader — even if a refresh threw — so a
      // failed fetch/pull can't leave the history surface stuck behind
      // the spinner. Ownership check (#1385): only clear when OUR claim
      // is still the latest — a later overlapping invocation that
      // installed its own loader now owns the clear, and yanking it
      // out from under that still-running op killed its loader early.
      if (remoteOp && remoteOpClaimRef.current === remoteOpClaim) {
        dispatch({ type: 'setRemoteOp', value: undefined })
      }
      // Same guarantee for the per-row pending spinner (delete or
      // checkout): clear it whether the action succeeded, failed, or the
      // refresh threw, so no row is left spinning forever — with the
      // same #1385 ownership check.
      if (pendingItemAction && pendingItemActionClaimRef.current === pendingItemActionClaim) {
        dispatch({ type: 'setPendingItemAction', value: undefined })
      }
    }
    // Identity-stable by design: the body reads exclusively through
    // `depsRef` / `lastDroppedStashRef`, so there is nothing render-scoped
    // to invalidate on. (Do NOT re-add state fields here — the enumerated
    // array drifted out of sync with the body once already and shipped
    // wrong-target destructive actions.)
  }, [])

  return {
    runWorkflowAction,
  }
}
