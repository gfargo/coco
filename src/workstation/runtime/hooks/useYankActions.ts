/**
 * Yank / clipboard action handlers (extracted in the 0.72 app.ts
 * decomposition, alongside `useChangelogActions`).
 *
 * This module lifts the two clipboard `React.useCallback` handlers out of
 * `app.ts`, preserving their original behavior verbatim:
 *
 *   1. `yankText` — the generic "copy this string" handler. Takes a value +
 *      label as an explicit event payload (used by the changelog view's `y`
 *      keystroke via `useChangelogActions`, which threads this callback in),
 *      resolves the clipboard runner (`clipboardRunner || defaultClipboardRunner`),
 *      and dispatches a success / empty / failure status. Dep array
 *      `[clipboardRunner, dispatch]`.
 *   2. `yankFromActiveView` — the view-polymorphic `y` / `Y` keystroke. Resolves
 *      a yank target (commit hash / branch / tag / stash ref / path / URL /
 *      sha) from the live filtered+sorted active-view list, then copies it to
 *      the clipboard with its own inline status handling. It does NOT call
 *      `yankText` — it resolves the same `clipboard` runner directly — so the
 *      two callbacks are independent (no in-hook cross-reference). Its ~31-item
 *      dep array is reproduced byte-for-byte.
 *
 * Both handler bodies and their `useCallback` dependency arrays are reproduced
 * byte-for-byte from `app.ts`. Both callbacks are invoked ONLY from the input
 * handler's keystroke dispatch (`yankText` / `yankFromActiveView` events) — NOT
 * referenced in any `useEffect` / `useMemo` dependency array — so there is no
 * identity-stability hazard from the move.
 *
 * The module-level helpers `yankFromActiveView` calls (`sortBranches`,
 * `sortTags`, `matchesPromotedFilter`, `getBisectCompletion`,
 * `findStashFileForOffset`) and the `ClipboardRunner` type +
 * `defaultClipboardRunner` are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { LogInkAction, LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { ClipboardRunner, defaultClipboardRunner } from '../../../git/historyActions'
import { sortBranches, sortTags } from '../../chrome/sorting'
import { matchesPromotedFilter } from '../promotedFilter'
import { getBisectCompletion } from '../../../git/bisectData'
import { findStashFileForOffset, type StashDiffFile } from '../../../git/stashData'
import type { WorktreeFile } from '../../../git/statusData'
import type { GitLogCommitRow, GitCommitDetail } from '../../../commands/log/data'

// Element types are derived from `LogInkContext` indexed access so they track
// the real overview shapes without re-importing each one (mirrors the
// convention in `buildFilteredLists`).
type RemoteListItem = NonNullable<LogInkContext['remotes']>['entries'][number]
type IssueListItem = NonNullable<NonNullable<LogInkContext['issueList']>['issues']>[number]
type PullRequestListItem =
  NonNullable<NonNullable<LogInkContext['pullRequestList']>['pullRequests']>[number]
type DetailFile = GitCommitDetail['files'][number]

export type UseYankActionsDeps = {
  /** Optional clipboard runner override; falls back to `defaultClipboardRunner`. */
  clipboardRunner?: ClipboardRunner
  /** Reducer dispatch — drives status messages. */
  dispatch: (action: LogInkAction) => void
  /** The active frame's context — branch / tag / stash / submodule / bisect lists. */
  context: LogInkContext
  /** The reducer state — active view, selection indices, filter, diff source. */
  state: LogInkState
  /** The cursored history commit. */
  selected: GitLogCommitRow | undefined
  /** The cursored commit-diff file. */
  selectedDetailFile: DetailFile | undefined
  /** Raw stash diff lines (presence gates the stash-diff yank path). */
  stashDiffLines: string[] | undefined
  /** Pre-parsed per-file segmentation of the active stash patch. */
  stashDiffParsedFiles: StashDiffFile[]
  /** Mask-filtered worktree file list (status / worktree-diff yank target). */
  visibleWorktreeFilesGrouped: WorktreeFile[]
  /** Filtered remote list (remotes-view yank target). */
  filteredRemoteList: RemoteListItem[]
  /** Filtered issue list (issues-view yank target). */
  filteredIssueList: IssueListItem[]
  /** Filtered PR-triage list (pull-request-triage-view yank target). */
  filteredPullRequestTriageList: PullRequestListItem[]
}

export type UseYankActionsResult = {
  yankText: (value: string, label: string) => Promise<void>
  yankFromActiveView: (short?: boolean) => Promise<void>
}

export function useYankActions(
  React: typeof ReactTypes,
  deps: UseYankActionsDeps,
): UseYankActionsResult {
  const {
    clipboardRunner,
    dispatch,
    context,
    state,
    selected,
    selectedDetailFile,
    stashDiffLines,
    stashDiffParsedFiles,
    visibleWorktreeFilesGrouped,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
  } = deps

  // Copy an arbitrary string to the system clipboard. Distinct from
  // `yankFromActiveView` which derives the value from the current view
  // — this one takes the value as an explicit event payload, used by
  // the changelog view's `y` keystroke (and a candidate for future
  // "copy this" surfaces). Surfaces a status confirming what landed
  // in clipboard.
  const yankText = React.useCallback(async (value: string, label: string) => {
    const clipboard: ClipboardRunner = clipboardRunner || defaultClipboardRunner
    if (!value) {
      dispatch({ type: 'setStatus', value: `Nothing to copy — ${label} is empty.`, kind: 'warning' })
      return
    }
    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label} to clipboard.`, kind: 'success' })
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Copy failed (${label}): ${(error as Error).message}`,
        kind: 'error',
      })
    }
  }, [clipboardRunner, dispatch])

  // Resolve the active view's "yank target" (commit hash / branch /
  // tag / stash ref / file path) against the live filtered+sorted list,
  // copy it to the system clipboard, and surface the result on the
  // status line. `short=true` opts into the short hash on history /
  // commit-diff views (Y vs y); ignored for ref-only views.
  const yankFromActiveView = React.useCallback(async (short?: boolean) => {
    const clipboard: ClipboardRunner = clipboardRunner || defaultClipboardRunner
    let value: string | undefined
    let label: string | undefined

    const view = state.activeView
    if (view === 'history') {
      const commit = state.filteredCommits[state.selectedIndex]
      if (commit) {
        value = short ? commit.shortHash : commit.hash
        label = short ? `short hash ${commit.shortHash}` : `commit ${commit.shortHash}`
      }
    } else if (view === 'branches') {
      const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
      const visible = state.filter
        ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
        : all
      const branch = visible[Math.min(state.selectedBranchIndex, Math.max(0, visible.length - 1))]
      if (branch) {
        value = branch.shortName
        label = `branch ${branch.shortName}`
      }
    } else if (view === 'tags') {
      const all = sortTags(context.tags?.tags || [], state.tagSort)
      const visible = state.filter
        ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
        : all
      const tag = visible[Math.min(state.selectedTagIndex, Math.max(0, visible.length - 1))]
      if (tag) {
        value = tag.name
        label = `tag ${tag.name}`
      }
    } else if (view === 'stash') {
      const all = context.stashes?.stashes || []
      const visible = state.filter
        ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
        : all
      const stash = visible[Math.min(state.selectedStashIndex, Math.max(0, visible.length - 1))]
      if (stash) {
        value = stash.ref
        label = `stash ${stash.ref}`
      }
    } else if (view === 'status') {
      // Read from the mask-filtered list (#776) so the cursor and the
      // yanked path always match what's on screen — yanking a hidden
      // row is always a desync bug.
      const path = visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]?.path
      if (path) {
        value = path
        label = `path ${path}`
      }
    } else if (view === 'submodules') {
      // #932 — yank from the dedicated submodules view. `y` (default)
      // copies the cursored submodule's path; `Y` (short) copies the
      // pinned commit's short sha. Either is what the user most
      // likely wants — path for `git submodule update <path>`, sha
      // for cross-referencing in logs or other repos.
      const entries = context.submodules?.entries || []
      const filtered = state.filter
        ? entries.filter((entry) => matchesPromotedFilter(
          [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
          state.filter,
        ))
        : entries
      const entry = filtered[Math.min(state.selectedSubmoduleIndex, Math.max(0, filtered.length - 1))]
      if (entry) {
        if (short) {
          if (entry.pinnedSha) {
            value = entry.pinnedSha.slice(0, 8)
            label = `short sha ${value} (submodule ${entry.name})`
          }
        } else {
          value = entry.path
          label = `submodule path ${entry.path}`
        }
      }
    } else if (view === 'remotes') {
      // #0.71 — yank from the dedicated remotes view. `y` copies the
      // cursored remote's fetch URL (the value the user most often
      // needs for a clone / config command). Short form (`Y`) is a
      // no-op — there's no compact alternate worth a second key.
      const entry = filteredRemoteList[
        Math.min(state.selectedRemoteIndex, Math.max(0, filteredRemoteList.length - 1))
      ]
      if (entry && entry.fetchUrl) {
        value = entry.fetchUrl
        label = `remote ${entry.name} URL`
      }
    } else if (view === 'issues') {
      // #882 phase 4 — y yanks the cursored issue's URL so the user
      // can paste it into Slack / a PR description / etc. without
      // dropping back to the browser. Short form (`Y`) is a no-op
      // here — there's no compact identifier worth a second key.
      const issue = filteredIssueList[
        Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
      ]
      if (issue) {
        value = issue.url
        label = `issue #${issue.number} URL`
      }
    } else if (view === 'pull-request-triage') {
      // #882 phase 4 — same URL-yank pattern for the multi-PR list.
      // Distinct from `pull-request` (single, current-branch); that
      // view falls through to the generic "Nothing to yank" path
      // below since the action panel already exposes O for browser
      // open.
      const pr = filteredPullRequestTriageList[
        Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
      ]
      if (pr) {
        value = pr.url
        label = `pull request #${pr.number} URL`
      }
    } else if (view === 'bisect') {
      // #879 item 3 — yank the first-bad commit sha from the
      // completion panel. The headline answer is what the user
      // came here to copy. Y opts into the short form; y returns
      // the full sha as recorded in BISECT_LOG.
      const completion = context.bisect?.active
        ? getBisectCompletion(context.bisect.log)
        : undefined
      if (completion) {
        value = short ? completion.sha.slice(0, 8) : completion.sha
        label = short
          ? `short hash ${completion.sha.slice(0, 8)} (first bad)`
          : `commit ${completion.sha.slice(0, 8)} (first bad)`
      }
    } else if (view === 'diff') {
      if (state.diffSource === 'worktree') {
        const path = visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]?.path
        if (path) {
          value = path
          label = `path ${path}`
        }
      } else if (state.diffSource === 'stash' && stashDiffLines) {
        // Walk back to the most recent file header at or before the
        // current preview offset — same logic the input-context block
        // uses to expose stashDiffSelectedPath. Reads the memoized
        // parse so the yank handler doesn't re-walk the entire patch.
        const current = findStashFileForOffset(stashDiffParsedFiles, state.diffPreviewOffset)
        if (current) {
          value = current.path
          label = `path ${current.path}`
        }
      } else if (state.diffSource === 'commit') {
        // Y on a commit-diff yanks the sha (handy when the user has
        // drilled into the file list); y yanks the cursored file path.
        if (short && selected) {
          value = selected.hash
          label = `commit ${selected.shortHash}`
        } else if (selectedDetailFile?.path) {
          value = selectedDetailFile.path
          label = `path ${selectedDetailFile.path}`
        } else if (selected) {
          value = selected.hash
          label = `commit ${selected.shortHash}`
        }
      }
    }

    if (!value || !label) {
      dispatch({ type: 'setStatus', value: 'Nothing to yank in this view', kind: 'warning' })
      return
    }

    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label}`, kind: 'success' })
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Copy failed: ${(error as Error).message}`, kind: 'error' })
    }
  }, [
    clipboardRunner,
    context.bisect,
    context.branches,
    context.stashes,
    context.submodules,
    context.tags,
    dispatch,
    filteredIssueList,
    filteredPullRequestTriageList,
    filteredRemoteList,
    selected,
    selectedDetailFile,
    stashDiffLines,
    stashDiffParsedFiles,
    state.activeView,
    state.branchSort,
    state.diffPreviewOffset,
    state.diffSource,
    state.filter,
    state.filteredCommits,
    state.selectedBranchIndex,
    state.selectedIndex,
    state.selectedIssueIndex,
    state.selectedPullRequestTriageIndex,
    state.selectedRemoteIndex,
    state.selectedStashIndex,
    state.selectedSubmoduleIndex,
    state.selectedTagIndex,
    state.selectedWorktreeFileIndex,
    state.tagSort,
    visibleWorktreeFilesGrouped,
  ])

  return {
    yankText,
    yankFromActiveView,
  }
}
