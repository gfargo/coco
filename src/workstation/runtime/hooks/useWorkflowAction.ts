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
import { sortBranches, sortTags } from '../../chrome/sorting'
import { openProviderUrl } from '../../../git/providerActions'
import type { GitProviderType } from '../../../git/providerData'
import {
  LogInkPendingItemAction,
  LogInkAction,
  LogInkState,
  RemoteOpState,
  getSelectedInkCommit,
} from '../inkViewModel'
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  isBranchCheckedOutElsewhereError,
  isBranchNotFullyMergedError,
  parseCheckedOutWorktreePath,
  fetchBranch,
  fetchRemotes,
  pullBranch,
  pullCurrentBranch,
  pushBranch,
  pushCurrentBranch,
  renameBranch,
  setUpstream,
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
} from '../../../git/historyActions'
import { applyStash, applyStashKeepIndex, checkoutFileFromStash, createStash, dropStash, popStash, renameStash, restoreStash, stashBranch } from '../../../git/stashActions'
import { ApplyHunkTarget, applyHunkPatch } from '../../../git/hunkActions'
import { removeWorktree, removeWorktreeAndBranch } from '../../../git/worktreeActions'
import { rebaseOnto } from '../../../git/rebaseActions'
import { abortOperation, continueOperation, resolveConflictKeepCurrentBranch, resolveConflictKeepIncoming, stageConflictResolved } from '../../../git/operationActions'
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
import { checkoutReflogEntry } from '../../../git/reflogActions'
import { initSubmodule, syncSubmodule, updateSubmodule } from '../../../git/submoduleActions'
import { addRemote, pruneRemote, removeRemote, setRemoteUrl } from '../../../git/remoteActions'
import { matchesPromotedFilter } from '../promotedFilter'
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
function resolvePendingItemAction(
  id: string,
  state: LogInkState,
  context: LogInkContext
): LogInkPendingItemAction | undefined {
  const { filter } = state
  // Checking out a branch gets the same inline spinner on its row as a
  // delete does — the action just runs `git checkout` instead of
  // `git branch -d`. Resolved the same way as the delete branch case
  // (and identically to the checkout-branch handler) so the spinner
  // lands on exactly the row the user pressed enter on.
  if (id === 'checkout-branch') {
    const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
    const visible = filter
      ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], filter))
      : all
    const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
    return branch ? { kind: 'branch', id: branch.shortName, action: 'checkout' } : undefined
  }
  if (id === 'delete-branch' || id === 'force-delete-branch') {
    const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
    const visible = filter
      ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], filter))
      : all
    const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
    return branch ? { kind: 'branch', id: branch.shortName, action: 'delete' } : undefined
  }
  if (id === 'delete-tag') {
    const all = sortTags(context.tags?.tags || [], state.tagSort)
    const visible = filter
      ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], filter))
      : all
    const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
    return tag ? { kind: 'tag', id: tag.name, action: 'delete' } : undefined
  }
  if (id === 'drop-stash') {
    const all = context.stashes?.stashes || []
    const visible = filter
      ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], filter))
      : all
    const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
    return stash ? { kind: 'stash', id: stash.ref, action: 'delete' } : undefined
  }
  if (id === 'remove-worktree') {
    const all = context.worktreeList?.worktrees || []
    const visible = filter
      ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], filter))
      : all
    const wt = visible.length
      ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
      : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
    return wt ? { kind: 'worktree', id: wt.path, action: 'delete' } : undefined
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
      })
      setContextStatus((current) => updateLogInkContextStatus(current, 'issueList', 'idle'))
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
      })
      setContextStatus((current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'))
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
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        if (branch.current) return { ok: true, message: `Already on ${branch.shortName}` }
        return checkoutBranch(git, branch)
      },
      'delete-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return deleteBranch(git, branch)
      },
      'force-delete-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return deleteBranch(git, branch, true)
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
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        if (branch.shortName === current) {
          return { ok: false, message: 'Cannot rebase a branch onto itself.' }
        }
        return rebaseOnto(git, branch.shortName)
      },
      'delete-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
        if (!tag) return { ok: false, message: 'No tag selected' }
        return deleteLocalTag(git, tag.name)
      },
      'push-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
        if (!tag) return { ok: false, message: 'No tag selected' }
        return pushTag(git, tag.name)
      },
      'drop-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        // Remember the dropped commit so `u` can undo it.
        if (stash.hash) lastDroppedStashRef.current = { hash: stash.hash, message: stash.message }
        return dropStash(git, stash)
      },
      'undo-drop-stash': async () => {
        const dropped = lastDroppedStashRef.current
        if (!dropped) return { ok: false, message: 'Nothing to undo — no stash dropped this session' }
        const result = await restoreStash(git, dropped.hash, dropped.message)
        if (result.ok) lastDroppedStashRef.current = null
        return result
      },
      'apply-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStash(git, stash)
      },
      'apply-stash-index': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStashKeepIndex(git, stash)
      },
      'pop-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return popStash(git, stash)
      },
      'rename-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return renameStash(git, stash, payload ?? '')
      },
      'stash-branch': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
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
        // Mode arrives via the action's `payload` field — the input
        // handler runs the reset-mode prompt (kind: 'reset-mode') and
        // routes the typed value here. Default to `mixed` (git's own
        // default) when the user submitted an empty value.
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
        const all = context.worktreeList?.worktrees || []
        // Resolve the target from the visible (filtered) list so a
        // hidden filtered-out worktree can never be the action target.
        // Falls back to the cursor against the unfiltered list when the
        // action is invoked from the palette without ever visiting the
        // worktrees view.
        const visible = state.filter
          ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
          : all
        const cursorTarget = visible.length
          ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
          : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
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
        const all = context.worktreeList?.worktrees || []
        const visible = state.filter
          ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
          : all
        const cursorTarget = visible.length
          ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
          : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
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
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return fetchBranch(git, branch)
      },
      'pull-selected-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pullBranch(git, branch, context.branches?.currentBranch)
      },
      'push-selected-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pushBranch(git, branch)
      },
      'add-to-gitignore': async () => addToGitignore(git, payload || ''),
      'rename-branch': async () => {
        const newName = payload?.trim()
        if (!newName) return { ok: false, message: 'New branch name required' }
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return renameBranch(git, branch.shortName, newName)
      },
      'set-upstream': async () => {
        const upstream = payload?.trim()
        if (!upstream) return { ok: false, message: 'Upstream ref required' }
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return setUpstream(git, branch.shortName, upstream)
      },
      'delete-remote-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
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
    if (remoteOp) {
      dispatch({ type: 'setRemoteOp', value: remoteOp })
    }
    // Mark the cursored row as busy so it shows an inline pending
    // spinner while the git call runs (delete or checkout). Cleared in
    // `finally` after the refresh, so a successful delete hands straight
    // off to the row vanishing, a checkout to the sidebar repainting
    // with the new current branch, and a failure (e.g. an unmerged
    // branch) restores the row's normal icon alongside the error status.
    const pendingItemAction = resolvePendingItemAction(id, state, context)
    if (pendingItemAction) {
      dispatch({ type: 'setPendingItemAction', value: pendingItemAction })
    }
    try {
    const result = await handler()
    dispatch({ type: 'setStatus', value: result?.message || 'Workflow action complete' })
    // A safe `delete-branch` (`git branch -d`) refuses branches that
    // aren't fully merged. Rather than dead-end on git's raw error, raise
    // a second y-confirm offering the force-delete (`git branch -D`). The
    // cursor hasn't moved (the delete failed), so the force handler
    // re-resolves the same branch.
    if (id === 'delete-branch' && !result?.ok && isBranchNotFullyMergedError(result?.message)) {
      dispatch({ type: 'setPendingConfirmation', value: 'force-delete-branch' })
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
      const branchName = pendingItemAction?.id
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
    if (id === 'checkout-branch' && !result?.ok && isBranchCheckedOutElsewhereError(result?.message)) {
      const worktreePath = parseCheckedOutWorktreePath(result?.message)
      const branchName = pendingItemAction?.id
      if (worktreePath && branchName) {
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
              { key: 'y', label: 'Switch to that worktree', intent: 'switch-worktree' },
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
    // Refresh history rows AS WELL when the workflow could have
    // changed the commits the user sees (#945 follow-up). The
    // workflow IDs below all either create/rewrite local commits or
    // change which branch's history is being viewed — without this
    // the history pane shows stale data even after the operation
    // succeeds. Cheap one-off `git log` call; doesn't fire on
    // metadata-only mutations (delete-tag, set-upstream, etc.).
    const historyMutatingIds = new Set([
      'checkout-branch',
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
      'reset-hard-to-commit',
      'reset-soft-to-commit',
      'reset-mixed-to-commit',
      'interactive-rebase-to-commit',
      // Rebasing the current branch onto a ref rewrites its commits —
      // refresh the graph so the replayed history (or the mid-rebase
      // conflict state) shows instead of staying pinned to the pre-rebase
      // tip.
      'rebase-onto-branch',
      'bisect-good',
      'bisect-bad',
      'bisect-skip',
      'bisect-reset',
    ])
    if (result?.ok && historyMutatingIds.has(id)) {
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
    if ((id === 'checkout-branch' || id === 'conflict-remove-worktree-checkout') && result?.ok) {
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
      // the spinner.
      if (remoteOp) {
        dispatch({ type: 'setRemoteOp', value: undefined })
      }
      // Same guarantee for the per-row pending spinner (delete or
      // checkout): clear it whether the action succeeded, failed, or the
      // refresh threw, so no row is left spinning forever.
      if (pendingItemAction) {
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
