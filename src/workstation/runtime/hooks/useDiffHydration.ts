/**
 * Lazy diff/hunks hydration (extracted in the 0.72 app.ts decomposition,
 * PR 8).
 *
 * This module lifts the cluster of "fetch the diff text / parsed hunks for
 * the active selection once the diff view becomes active" effects out of
 * `app.ts`. Five effects, one per diff *source*, each fetching lazily into
 * its own dedicated `useState` slot:
 *
 *   1. Stash diff    — `getStashDiff(git, stashDiffRef)` once the diff view
 *      is active with `diffSource === 'stash'`, into `stashDiffLines`.
 *   2. Compare diff  — `getCompareDiff(git, base, head)` once active with
 *      `diffSource === 'compare'`, into `compareDiffLines`.
 *   3. Worktree hunks — `getWorktreeHunks(git, selectedWorktreeFile)` for
 *      the cursored worktree file, into `worktreeHunks`.
 *   4. Worktree file diff — `getWorktreeFileDiff(git, selectedWorktreeFile)`
 *      for the cursored worktree file, into `worktreeDiff`.
 *   5. Commit file preview — `getCommitFilePreview(git, sha, file)` for the
 *      cursored commit's selected file, into `filePreview`.
 *
 * Each effect is a best-effort lazy loader: the fetch is wrapped in `safe()`
 * (errors fall through to a "no diff" hint at the render site), guarded with
 * an `active` flag flipped false in cleanup so a stale in-flight load can't
 * clobber a newer selection, and toggles a `*Loading` flag around the await.
 *
 * Unlike the detail-hydration cluster (PR 7), these loaders write to *local*
 * `useState` slots — `setStashDiffLines`, `setCompareDiffLines`,
 * `setWorktreeHunks`, `setWorktreeDiff`, `setFilePreview` — rather than into
 * the frame-tagged `context`. There is therefore no `issuedAtDepth`
 * frame-tag here: cancellation is the `active` flag alone, exactly as in the
 * original inline code. The five effects are reproduced **verbatim and
 * separate** — the guard conditions, the `active` flag, the `safe()`
 * wrapper, the `set*Loading` toggles, and the dependency arrays are
 * byte-for-byte the same as the original `app.ts` effects. This is a
 * behavior-preserving move, not a rewrite; they are deliberately NOT unified
 * despite their similar shape.
 *
 * CRITICAL — hook ordering. The five effects are NOT contiguous in `app.ts`:
 * they are scattered across ~3200 lines (the stash, compare, and worktree
 * loaders sit ~1082–1692; the commit file-preview loader sits ~4259),
 * interleaved with unrelated effects (the boot-load, PR-overview, bisect,
 * compare-reset, branch-tab-sync and syntax-highlight effects). React fires
 * hooks in declaration order, so collapsing them into one call site would
 * reorder them relative to those intervening hooks. To preserve ordering
 * exactly, this module exports *five* hooks, each called at its original
 * slot in `app.ts`. Order correctness wins over tidiness.
 *
 * State ownership. Each diff slot's `useState` is owned here by a dedicated
 * *state hook* (`useStashDiffState`, `useCompareDiffState`,
 * `useWorktreeHunksState`, `useWorktreeDiffState`, `useCommitFilePreviewState`),
 * each called at the slot's original position near the top of `app.ts` so React
 * hook order is preserved (a position-preserving split — the loaders stay at
 * their own original slots far below). The state hook returns the value(s) +
 * setter(s); `app.ts` threads them into the matching loader **and** into any
 * other consumer that writes the setter:
 *   - `setWorktreeDiff` / `setWorktreeHunks` are also called by the staging
 *     callbacks (`useWorktreeStageActions`);
 *   - `setCompareDiffLines` / `setCompareDiffLoading` are also called by the
 *     compare-reset effect.
 * Because the returned setters keep the same names, those consumer call sites
 * are unchanged — only the bare `useState` declarations became hook calls
 * (app.ts decomposition items 1a / 2 / #1237). Mirrors the `useCommitDetailState`
 * + `useCommitDetailHydration` split (item 1a).
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import {
  GitCommitDetail,
  GitCommitFilePreview,
  GitLogCommitRow,
  getCommitFilePreview,
} from '../../../commands/log/data'
import { getCompareDiff } from '../../../git/compareData'
import { getStashDiff } from '../../../git/stashData'
import { WorktreeHunkOverview, getWorktreeHunks } from '../../../git/statusHunks'
import type { WorktreeFile } from '../../../git/statusData'
import { WorktreeFileDiff, getWorktreeFileDiff } from '../../../git/worktreeDiffData'
import type { LogInkDiffSource, LogInkView } from '../inkViewModel'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a git error leaves the diff surface on its "no diff" hint
 * instead of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

/**
 * Pure guard shared (identically) by the worktree-hunks and
 * worktree-file-diff loaders: hydrate the worktree diff data only when the
 * diff view is active *and* a worktree file is cursored. Returns `false`
 * when either is missing (the effects reset their state and bail), `true`
 * when both hold (the fetch should run).
 *
 * The effects keep their guard inline and byte-for-byte; this helper
 * documents and tests the decision rather than replacing it.
 */
export function shouldLoadWorktreeDiff(
  activeView: LogInkView,
  selectedWorktreeFile: WorktreeFile | undefined,
): boolean {
  return activeView === 'diff' && Boolean(selectedWorktreeFile)
}

/**
 * Owns the stash-diff `useState` pair, in its original `app.ts` slot. Both
 * setters are written only by {@link useStashDiffHydration}. Returns the
 * values (read by the render) + setters (threaded into the loader). A
 * position-preserving split; see the module header.
 */
export function useStashDiffState(React: typeof ReactTypes): {
  stashDiffLines: string[] | undefined
  setStashDiffLines: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<string[] | undefined>
  >
  stashDiffLoading: boolean
  setStashDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [stashDiffLines, setStashDiffLines] = React.useState<
    string[] | undefined
  >(undefined)
  const [stashDiffLoading, setStashDiffLoading] = React.useState(false)
  return { stashDiffLines, setStashDiffLines, stashDiffLoading, setStashDiffLoading }
}

export type UseStashDiffHydrationDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** `state.activeView` — only `'diff'` triggers a load. */
  activeView: LogInkView
  /** `state.diffSource` — only `'stash'` triggers a load. */
  diffSource: LogInkDiffSource | undefined
  /** `state.stashDiffRef` — the stash ref to `git stash show -p`. */
  stashDiffRef: string | undefined
  /** Writer for the loaded stash diff lines. */
  setStashDiffLines: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<string[] | undefined>
  >
  /** Loading-flag setter for the stash diff fetch. */
  setStashDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * P-stash-explorer: load `git stash show -p <ref>` once the diff view
 * becomes active with diffSource='stash'. Lifted verbatim from `app.ts`.
 */
export function useStashDiffHydration(
  React: typeof ReactTypes,
  deps: UseStashDiffHydrationDeps,
): void {
  const {
    git,
    activeView,
    diffSource,
    stashDiffRef,
    setStashDiffLines,
    setStashDiffLoading,
  } = deps

  React.useEffect(() => {
    if (activeView !== 'diff' || diffSource !== 'stash' || !stashDiffRef) {
      // Clear the loading flag on the guard-fail bail: if the view changes
      // away from the stash diff while a fetch is in flight, the cleanup flips
      // `active` false so the in-flight branch never resets it — without this
      // the flag stays stuck `true`.
      setStashDiffLoading(false)
      return
    }
    let active = true
    setStashDiffLoading(true)
    void (async () => {
      const lines = await safe(getStashDiff(git, stashDiffRef!))
      if (active) {
        setStashDiffLines(lines || [])
        setStashDiffLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, activeView, diffSource, stashDiffRef])
}

/**
 * Owns the compare-diff `useState` pair, in its original `app.ts` slot. Both
 * setters are shared — {@link useCompareDiffHydration} *and* the compare-reset
 * effect in `app.ts` write them — so this hook owns the slots and returns the
 * values + setters, which `app.ts` threads into both. A position-preserving
 * split; see the module header.
 */
export function useCompareDiffState(React: typeof ReactTypes): {
  compareDiffLines: string[] | undefined
  setCompareDiffLines: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<string[] | undefined>
  >
  compareDiffLoading: boolean
  setCompareDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [compareDiffLines, setCompareDiffLines] = React.useState<
    string[] | undefined
  >(undefined)
  const [compareDiffLoading, setCompareDiffLoading] = React.useState(false)
  return {
    compareDiffLines,
    setCompareDiffLines,
    compareDiffLoading,
    setCompareDiffLoading,
  }
}

export type UseCompareDiffHydrationDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** `state.activeView` — only `'diff'` triggers a load. */
  activeView: LogInkView
  /** `state.diffSource` — only `'compare'` triggers a load. */
  diffSource: LogInkDiffSource | undefined
  /** `state.compareBase?.ref` — the base ref of the comparison. */
  compareBaseRef: string | undefined
  /** `state.compareHead?.ref` — the head ref of the comparison. */
  compareHeadRef: string | undefined
  /** Writer for the loaded compare diff lines. */
  setCompareDiffLines: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<string[] | undefined>
  >
  /** Loading-flag setter for the compare diff fetch. */
  setCompareDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * #779 — load `git diff <base>..<head>` once the diff view becomes active
 * with diffSource='compare'. Lifted verbatim from `app.ts`.
 */
export function useCompareDiffHydration(
  React: typeof ReactTypes,
  deps: UseCompareDiffHydrationDeps,
): void {
  const {
    git,
    activeView,
    diffSource,
    compareBaseRef,
    compareHeadRef,
    setCompareDiffLines,
    setCompareDiffLoading,
  } = deps

  React.useEffect(() => {
    if (
      activeView !== 'diff' ||
      diffSource !== 'compare' ||
      !compareBaseRef ||
      !compareHeadRef
    ) {
      // Clear the loading flag on the guard-fail bail (see the stash loader):
      // a view change while a compare fetch is in flight would otherwise leave
      // it stuck `true`.
      setCompareDiffLoading(false)
      return
    }
    let active = true
    setCompareDiffLoading(true)
    void (async () => {
      const lines = await safe(getCompareDiff(git, compareBaseRef, compareHeadRef))
      if (active) {
        setCompareDiffLines(lines || [])
        setCompareDiffLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, activeView, diffSource, compareBaseRef, compareHeadRef])
}

/**
 * Owns the worktree-hunks `useState` pair, in its original `app.ts` slot.
 * `setWorktreeHunks` is shared — {@link useWorktreeHunksHydration} *and* the
 * staging callbacks (`useWorktreeStageActions`) write it — so this hook owns
 * the slots and returns the values + setters, which `app.ts` threads into both.
 * `setWorktreeHunksLoading` is loader-only. A position-preserving split; see
 * the module header.
 */
export function useWorktreeHunksState(React: typeof ReactTypes): {
  worktreeHunks: WorktreeHunkOverview | undefined
  setWorktreeHunks: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeHunkOverview | undefined>
  >
  worktreeHunksLoading: boolean
  setWorktreeHunksLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [worktreeHunks, setWorktreeHunks] = React.useState<
    WorktreeHunkOverview | undefined
  >(undefined)
  const [worktreeHunksLoading, setWorktreeHunksLoading] = React.useState(false)
  return {
    worktreeHunks,
    setWorktreeHunks,
    worktreeHunksLoading,
    setWorktreeHunksLoading,
  }
}

export type UseWorktreeHunksHydrationDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** `state.activeView` — only `'diff'` triggers a load. */
  activeView: LogInkView
  /** The cursored worktree file (from `useStatusSurfaceData`). */
  selectedWorktreeFile: WorktreeFile | undefined
  /** Writer for the parsed worktree hunks. */
  setWorktreeHunks: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeHunkOverview | undefined>
  >
  /** Loading-flag setter for the worktree hunks fetch. */
  setWorktreeHunksLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Parse the cursored worktree file's hunks once the diff view is active.
 * Lifted verbatim from `app.ts`.
 */
export function useWorktreeHunksHydration(
  React: typeof ReactTypes,
  deps: UseWorktreeHunksHydrationDeps,
): void {
  const {
    git,
    activeView,
    selectedWorktreeFile,
    setWorktreeHunks,
    setWorktreeHunksLoading,
  } = deps

  React.useEffect(() => {
    let active = true

    async function loadWorktreeHunks(): Promise<void> {
      if (activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeHunks(undefined)
        setWorktreeHunksLoading(false)
        return
      }

      setWorktreeHunksLoading(true)
      const nextHunks = await safe(getWorktreeHunks(git, selectedWorktreeFile))

      if (active) {
        setWorktreeHunks(nextHunks)
        setWorktreeHunksLoading(false)
      }
    }

    void loadWorktreeHunks()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    activeView,
  ])
}

/**
 * Owns the worktree-file-diff `useState` pair, in its original `app.ts` slot.
 * `setWorktreeDiff` is shared — {@link useWorktreeDiffHydration} *and* the
 * staging callbacks (`useWorktreeStageActions`) write it — so this hook owns
 * the slots and returns the values + setters, which `app.ts` threads into both.
 * `setWorktreeDiffLoading` is loader-only. A position-preserving split; see the
 * module header.
 */
export function useWorktreeDiffState(React: typeof ReactTypes): {
  worktreeDiff: WorktreeFileDiff | undefined
  setWorktreeDiff: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeFileDiff | undefined>
  >
  worktreeDiffLoading: boolean
  setWorktreeDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [worktreeDiff, setWorktreeDiff] = React.useState<
    WorktreeFileDiff | undefined
  >(undefined)
  const [worktreeDiffLoading, setWorktreeDiffLoading] = React.useState(false)
  return {
    worktreeDiff,
    setWorktreeDiff,
    worktreeDiffLoading,
    setWorktreeDiffLoading,
  }
}

export type UseWorktreeDiffHydrationDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** `state.activeView` — only `'diff'` triggers a load. */
  activeView: LogInkView
  /** The cursored worktree file (from `useStatusSurfaceData`). */
  selectedWorktreeFile: WorktreeFile | undefined
  /** Writer for the loaded worktree file diff. */
  setWorktreeDiff: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeFileDiff | undefined>
  >
  /** Loading-flag setter for the worktree file diff fetch. */
  setWorktreeDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Load the cursored worktree file's diff once the diff view is active.
 * Lifted verbatim from `app.ts`.
 */
export function useWorktreeDiffHydration(
  React: typeof ReactTypes,
  deps: UseWorktreeDiffHydrationDeps,
): void {
  const {
    git,
    activeView,
    selectedWorktreeFile,
    setWorktreeDiff,
    setWorktreeDiffLoading,
  } = deps

  React.useEffect(() => {
    let active = true

    async function loadWorktreeDiff(): Promise<void> {
      if (activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeDiff(undefined)
        setWorktreeDiffLoading(false)
        return
      }

      setWorktreeDiffLoading(true)
      const nextDiff = await safe(getWorktreeFileDiff(git, selectedWorktreeFile))

      if (active) {
        setWorktreeDiff(nextDiff)
        setWorktreeDiffLoading(false)
      }
    }

    void loadWorktreeDiff()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    activeView,
  ])
}

/** The cursored commit's selected detail file, as fed to the preview load. */
type SelectedDetailFile = GitCommitDetail['files'][number] | undefined

/**
 * Issues the commit file-preview `useState` pair, in its original `app.ts`
 * position (top of the hydration-state block, ~900 lines above the loader
 * effect). `setFilePreview` / `setFilePreviewLoading` are written *only* by
 * {@link useCommitFilePreviewHydration}, so — unlike the worktree / stash /
 * compare slots whose setters are shared with staging callbacks and the
 * compare-reset effect — this pair can be owned here. Returns the values (the
 * preview drives the syntax-highlight effect and the diff render surfaces) and
 * the setters (threaded into the loader). A position-preserving split that
 * keeps every hook in its original slot; see the module header.
 */
export function useCommitFilePreviewState(React: typeof ReactTypes): {
  filePreview: GitCommitFilePreview | undefined
  setFilePreview: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<GitCommitFilePreview | undefined>
  >
  filePreviewLoading: boolean
  setFilePreviewLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [filePreview, setFilePreview] = React.useState<
    GitCommitFilePreview | undefined
  >(undefined)
  const [filePreviewLoading, setFilePreviewLoading] = React.useState(false)
  return { filePreview, setFilePreview, filePreviewLoading, setFilePreviewLoading }
}

export type UseCommitFilePreviewHydrationDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** The cursored commit row (drives the `sha`), or `undefined`. */
  selected: GitLogCommitRow | undefined
  /** The cursored commit's selected detail file. */
  selectedDetailFile: SelectedDetailFile
  /** Writer for the loaded per-file commit preview. */
  setFilePreview: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<GitCommitFilePreview | undefined>
  >
  /** Loading-flag setter for the commit file preview fetch. */
  setFilePreviewLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Load the per-file diff preview for the cursored commit's selected file.
 * Lifted verbatim from `app.ts`.
 */
export function useCommitFilePreviewHydration(
  React: typeof ReactTypes,
  deps: UseCommitFilePreviewHydrationDeps,
): void {
  const {
    git,
    selected,
    selectedDetailFile,
    setFilePreview,
    setFilePreviewLoading,
  } = deps

  React.useEffect(() => {
    let active = true

    async function loadPreview(): Promise<void> {
      if (!selected || !selectedDetailFile) {
        setFilePreview(undefined)
        // Reset the loading flag too (see the commit-detail loader): if the
        // selection / file clears mid-fetch, the `active` guard suppresses the
        // in-flight reset, leaving the preview stuck on "Loading…".
        setFilePreviewLoading(false)
        return
      }

      setFilePreviewLoading(true)
      const nextPreview = await safe(getCommitFilePreview(git, selected.hash, selectedDetailFile))

      if (active) {
        setFilePreview(nextPreview)
        setFilePreviewLoading(false)
      }
    }

    void loadPreview()

    return () => {
      active = false
    }
  }, [git, selected?.hash, selectedDetailFile?.path, selectedDetailFile?.oldPath])
}
