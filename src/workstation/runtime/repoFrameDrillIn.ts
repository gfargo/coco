import { join } from 'path'
import type { SubmoduleChange } from '../../git/submoduleDiff'
import type { GitCommitFilePreview } from '../../commands/log/data'
import type { LogInkRepoFrameEntryRange } from '../../workstation/runtime/inkViewModel'
import { findSubmoduleByPath, type SubmoduleOverview } from '../../git/submoduleData'

/**
 * Resolved target for a commit-diff drill-in (#931 PR 3b). When the
 * user presses Enter on a file row in the diff view AND that file is
 * a submodule (gitlink), the runtime builds one of these and dispatches
 * a matching `pushRepoFrame` action. Undefined means "the cursored
 * file is not a drill-in candidate" — the input handler falls through
 * to its usual diff-view Enter behavior.
 */
export type CommitDiffSubmoduleDrillInTarget = {
  /** Display label for the new frame — the submodule's name from `.gitmodules`. */
  label: string
  /**
   * Absolute working-directory path for `simpleGit(workdir)`. Resolved
   * against the current frame's repo root so this helper stays usable
   * for recursive submodule drill-ins (a sub-submodule's workdir is
   * `${parentSubmoduleAbsolutePath}/${subPath}`).
   */
  workdir: string
  /**
   * The `(oldPin, newPin)` sha pair captured at push time. Drives the
   * breadcrumb hint and the default landing view scoped to that range.
   * Undefined when the diff is an `added` submodule (no oldPin) or
   * `removed` (no newPin) — those drill-ins still work but land on
   * the submodule's full history without a range filter.
   */
  entryRange?: LogInkRepoFrameEntryRange
}

export type ResolveDrillInArgs = {
  /** The file the diff-view cursor is on. */
  selectedFile: Pick<GitCommitFilePreview, 'path' | 'submoduleChange'>
  /** Submodule overview loaded from `getSubmoduleOverview` for the active frame. */
  submodules: SubmoduleOverview | undefined
  /** Active frame's repo root (resolved from `git.revparse --show-toplevel`). */
  activeRepoRoot: string | undefined
}

/**
 * Pure resolver: given the cursored file + the active frame's
 * submodule overview + repo root, decide whether a commit-diff Enter
 * keystroke should drill into a submodule and, if so, what payload
 * the `pushRepoFrame` action should carry.
 *
 * Returns undefined when:
 *   - We don't know the active repo root yet (boot still in flight).
 *   - The file's path doesn't correspond to a registered submodule.
 *   - The submodule overview hasn't loaded yet for the active frame.
 *
 * The `submoduleChange` on the file preview is the source of truth
 * for the entry range; we never need to re-run the diff to populate
 * the (oldSha, newSha) pair.
 */
export function resolveCommitDiffDrillInTarget(
  args: ResolveDrillInArgs,
): CommitDiffSubmoduleDrillInTarget | undefined {
  const { selectedFile, submodules, activeRepoRoot } = args
  if (!activeRepoRoot) return undefined
  if (!submodules || !submodules.hasSubmodules) return undefined

  const entry = findSubmoduleByPath(submodules, selectedFile.path)
  if (!entry) return undefined

  return {
    label: entry.name,
    workdir: join(activeRepoRoot, entry.path),
    entryRange: deriveEntryRange(selectedFile.submoduleChange),
  }
}

/**
 * Convert the structured `SubmoduleChange` (from `extractSubmoduleChange`)
 * into the `entryRange` shape `LogInkRepoFrame` carries. Modified
 * submodules surface both shas; added / removed surface only one,
 * which isn't enough to scope a history range — those cases return
 * undefined and the frame lands on the submodule's full history.
 */
function deriveEntryRange(
  change: SubmoduleChange | undefined,
): LogInkRepoFrameEntryRange | undefined {
  if (!change) return undefined
  if (change.kind === 'modified') {
    return { oldSha: change.before, newSha: change.after }
  }
  return undefined
}

/**
 * Drill-in target for the dedicated submodules view (#931 PR 4 / #932).
 * Same shape as the commit-diff drill-in but without the `entryRange`
 * field — the submodules view doesn't carry diff context, so the frame
 * lands on the submodule's full history rather than a (oldPin, newPin)
 * range.
 */
export type SubmoduleViewDrillInTarget = {
  label: string
  workdir: string
}

export type ResolveSubmoduleViewDrillInArgs = {
  /** Index of the cursored row in the submodules view (`state.selectedSubmoduleIndex`). */
  selectedIndex: number
  /** Submodule overview loaded from `getSubmoduleOverview` for the active frame. */
  submodules: SubmoduleOverview | undefined
  /** Active frame's repo root (resolved from `git.revparse --show-toplevel`). */
  activeRepoRoot: string | undefined
}

/**
 * Pure resolver for the submodules-view drill-in (#931 PR 4 / #932).
 * Given the cursored row index + the submodule overview + the active
 * frame's repo root, build the `pushRepoFrame` payload Enter should
 * dispatch. Returns undefined when:
 *
 *   - The active repo root hasn't loaded yet.
 *   - The submodule overview hasn't loaded (or is empty).
 *   - The cursor is past the end of the entries (race between a
 *     refresh that removed a submodule and a key press still in
 *     flight against the old length).
 *   - The cursored entry has no `path` recorded. The `.gitmodules`
 *     parser already filters these out upstream, but the resolver
 *     defends against it so the cursor can't yank the user into a
 *     workdir-less frame.
 */
export function resolveSubmoduleViewDrillInTarget(
  args: ResolveSubmoduleViewDrillInArgs,
): SubmoduleViewDrillInTarget | undefined {
  const { selectedIndex, submodules, activeRepoRoot } = args
  if (!activeRepoRoot) return undefined
  if (!submodules || !submodules.hasSubmodules) return undefined

  const entry = submodules.entries[selectedIndex]
  if (!entry || !entry.path) return undefined

  return {
    label: entry.name,
    workdir: join(activeRepoRoot, entry.path),
  }
}
