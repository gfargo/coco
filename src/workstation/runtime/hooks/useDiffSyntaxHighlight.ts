/**
 * Diff syntax-highlight hydration (extracted in the post-0.72 app.ts
 * decomposition, item 2 / #1237).
 *
 * This module lifts the "tokenize the diff currently in view, off the render
 * path" cluster out of `app.ts` (#1117 follow-up): the `diffSyntaxSpans`
 * `useState` slot and the effect that, when the diff view is active, detects
 * the active file + its diff lines (commit or worktree source), runs them
 * through `highlightDiffCode` (tree-sitter), and stores the per-line spans for
 * the renderer. Stash / compare sources aren't highlighted (multi-file patch /
 * no single path), and highlighting is gated on the config flag + a color
 * terminal.
 *
 * The effect is reproduced **verbatim** — the same gate, the same
 * commit-vs-worktree source detection, the `active` cancellation flag, the
 * `highlightDiffCode(...).then/.catch` shape, and the dependency array are
 * byte-for-byte the same as the original `app.ts` effect. This is a
 * behavior-preserving move, not a rewrite.
 *
 * `setDiffSyntaxSpans` is written *only* by this effect (no staging callback
 * or reset effect touches it), so — unlike the worktree / stash / compare diff
 * slots — the `useState` is owned here.
 *
 * CRITICAL — hook ordering. In `app.ts` the `diffSyntaxSpans` `useState` sits
 * near the top of the hydration-state block (~L527), while the effect sits
 * ~600 lines below (~L1159), separated by many intervening hooks. React fires
 * hooks in declaration order, so collapsing the `useState` and the effect into
 * a single call site would reorder one of them relative to those intervening
 * hooks — moving the `useState` down corrupts every state slot after it
 * (catastrophic), and moving the effect up changes effect-execution order
 * (which the render-snapshot suite does not catch). To preserve ordering
 * exactly, this module exports *two* hooks, each called at the original
 * position:
 *
 *   const { diffSyntaxSpans, setDiffSyntaxSpans } = useDiffSyntaxState(React) // ~L527
 *   ...intervening hooks...
 *   useDiffSyntaxHighlight(React, { ..., setDiffSyntaxSpans })                // ~L1159
 *
 * Order correctness wins. Mirrors the `useCommitDetailState` +
 * `useCommitDetailHydration` split (item 1a).
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { GitCommitDetail, GitCommitFilePreview } from '../../../commands/log/data'
import type { WorktreeFileDiff } from '../../../git/worktreeDiffData'
import { highlightDiffCode, type SyntaxSpan } from '../../../lib/syntax/highlightEngine'
import type { LogInkDiffSource, LogInkView } from '../inkViewModel'

/** The cursored commit's selected detail file (drives the commit-source path). */
type SelectedDetailFile = GitCommitDetail['files'][number] | undefined

/**
 * Issues only the `diffSyntaxSpans` `useState`, in its original `app.ts`
 * position (top of the hydration-state block, ~600 lines above the effect).
 * Returns the value (read by the diff render surface) and the setter (threaded
 * into {@link useDiffSyntaxHighlight} so the effect can store / clear spans
 * exactly as the inline code did). A position-preserving split; see the module
 * header.
 */
export function useDiffSyntaxState(React: typeof ReactTypes): {
  diffSyntaxSpans: Map<string, SyntaxSpan[]> | undefined
  setDiffSyntaxSpans: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<Map<string, SyntaxSpan[]> | undefined>
  >
} {
  const [diffSyntaxSpans, setDiffSyntaxSpans] = React.useState<
    Map<string, SyntaxSpan[]> | undefined
  >(undefined)
  return { diffSyntaxSpans, setDiffSyntaxSpans }
}

export type UseDiffSyntaxHighlightDeps = {
  /** Config flag (`syntaxHighlightEnabled`) — off ⇒ never highlight. */
  syntaxHighlightEnabled: boolean | undefined
  /** `theme.noColor` — a no-color terminal skips highlighting. */
  noColor: boolean | undefined
  /** `state.activeView` — only the `'diff'` view highlights. */
  activeView: LogInkView
  /** `state.diffSource` — `'commit'` uses the file preview, else worktree. */
  diffSource: LogInkDiffSource | undefined
  /** The cursored commit's selected detail file (commit-source path). */
  selectedDetailFile: SelectedDetailFile
  /** The loaded commit file preview (commit-source lines via `.hunks`). */
  filePreview: GitCommitFilePreview | undefined
  /** The loaded worktree file diff (worktree-source path + lines). */
  worktreeDiff: WorktreeFileDiff | undefined
  /** Writer for the per-line spans, from {@link useDiffSyntaxState}. */
  setDiffSyntaxSpans: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<Map<string, SyntaxSpan[]> | undefined>
  >
}

/**
 * Issues the diff syntax-highlight effect, in its original `app.ts` position.
 * Reproduced verbatim — same gate, same commit-vs-worktree source detection,
 * same `active` cancellation flag, same `highlightDiffCode(...).then/.catch`,
 * same dependency array.
 */
export function useDiffSyntaxHighlight(
  React: typeof ReactTypes,
  deps: UseDiffSyntaxHighlightDeps,
): void {
  const {
    syntaxHighlightEnabled,
    noColor,
    activeView,
    diffSource,
    selectedDetailFile,
    filePreview,
    worktreeDiff,
    setDiffSyntaxSpans,
  } = deps

  React.useEffect(() => {
    if (!syntaxHighlightEnabled || noColor || activeView !== 'diff') {
      setDiffSyntaxSpans(undefined)
      return
    }
    let filePath: string | undefined
    let lines: string[] | undefined
    if (diffSource === 'commit') {
      filePath = selectedDetailFile?.path
      lines = filePreview?.hunks
    } else if (worktreeDiff && !worktreeDiff.untracked) {
      filePath = worktreeDiff.filePath
      lines = worktreeDiff.lines
    }
    if (!filePath || !lines || lines.length === 0) {
      setDiffSyntaxSpans(undefined)
      return
    }
    let active = true
    void highlightDiffCode(filePath, lines)
      .then((map) => {
        if (active) setDiffSyntaxSpans(map.size > 0 ? map : undefined)
      })
      .catch(() => {
        if (active) setDiffSyntaxSpans(undefined)
      })
    return () => {
      active = false
    }
  }, [
    syntaxHighlightEnabled,
    noColor,
    activeView,
    diffSource,
    selectedDetailFile?.path,
    filePreview,
    worktreeDiff,
  ])
}
