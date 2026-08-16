import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * File-history view input handlers, consolidated out of `inkInput.ts`'s
 * router (#1722, continuing the bisect/rebase/changelog/conflicts
 * extractions). Interleaved with the blame view's handlers at every call
 * site — see `surfaces/blame/input.ts`, called immediately before this
 * one at each shared slot.
 */
export type LogInkFileHistoryInputSlot =
  | 'jump-top'
  | 'jump-bottom'
  | 'move-up'
  | 'move-down'
  | 'page-up'
  | 'page-down'
  | 'enter'

export function handleFileHistoryInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  context: LogInkInputContext,
  slot: LogInkFileHistoryInputSlot
): LogInkInputEvent[] | null {
  if (state.activeView !== 'file-history') {
    return null
  }

  switch (slot) {
    // View-local top jump (#1387): `gg` moves the visible file-history
    // cursor, not the hidden history cursor the generic moveToTop below
    // drives. Always handled once the view matches.
    case 'jump-top':
      return context.fileHistoryCommitCount
        ? [
          action({
            type: 'moveFileHistory',
            delta: -context.fileHistoryCommitCount,
            count: context.fileHistoryCommitCount,
          }),
          action({ type: 'setStatus', value: 'jumped to first commit', ttl: 'echo' }),
        ]
        : []

    // View-local bottom jump (#1387) — mirror of jump-top.
    case 'jump-bottom':
      return context.fileHistoryCommitCount
        ? [
          action({
            type: 'moveFileHistory',
            delta: context.fileHistoryCommitCount,
            count: context.fileHistoryCommitCount,
          }),
          action({ type: 'setStatus', value: 'jumped to last commit', ttl: 'echo' }),
        ]
        : []

    // Single-commit movement. Only claims the keystroke when there are
    // commits to move through — otherwise falls through (returns null)
    // so the router's shared movement chain can keep checking other views.
    case 'move-up':
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: -1, count: context.fileHistoryCommitCount })]
        : null

    case 'move-down':
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: 1, count: context.fileHistoryCommitCount })]
        : null

    // View-local paging (#1387) — the generic `page` fallback moves the
    // hidden history cursor beneath this surface. Always handled once
    // the view matches, mirroring jump-top/jump-bottom above.
    case 'page-up':
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: -10, count: context.fileHistoryCommitCount })]
        : []

    case 'page-down':
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: 10, count: context.fileHistoryCommitCount })]
        : []

    // Enter drills into the diff for the commit under the cursor (#COCO-14).
    // The hash is resolved in `useInputHandler.ts` (from the cached
    // `FileHistoryResult`) and carried here as `context.fileHistorySelectedHash`.
    // Mirrors the reflog drill-in: find the sha in `filteredCommits` first,
    // fall back to `state.selectedIndex` if the commit isn't in the
    // currently-loaded history window.
    case 'enter': {
      if (!key.return || !context.fileHistorySelectedHash) {
        return null
      }
      const sha = context.fileHistorySelectedHash
      const fallbackIndex = state.commits.findIndex((commit) => commit.hash === sha)
      return [
        action({
          type: 'navigateOpenDiffForCommit',
          sha,
          commitIndex: fallbackIndex >= 0 ? fallbackIndex : state.selectedIndex,
        }),
        action({ type: 'setStatus', value: `viewing diff for ${sha.slice(0, 7)}` }),
      ]
    }

    default:
      return null
  }
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
