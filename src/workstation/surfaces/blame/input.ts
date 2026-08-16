import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * Blame view input handlers, consolidated out of `inkInput.ts`'s router
 * (#1722, continuing the bisect/rebase/changelog/conflicts extractions).
 * Like conflicts, these branches are NOT contiguous: they're interleaved
 * with the file-history view's own handlers (the two views share near-
 * identical linear-list navigation and sit side by side at every call
 * site — see `surfaces/fileHistory/input.ts`) and, at the `jump-top`
 * slot, with the changelog view too. The router calls this once per
 * `slot`, at each original branch's exact original position, immediately
 * followed by the equivalent `handleFileHistoryInput` call.
 */
export type LogInkBlameInputSlot =
  | 'jump-top'
  | 'jump-bottom'
  | 'move-up'
  | 'move-down'
  | 'page-up'
  | 'page-down'
  | 'open-file-history'

export function handleBlameInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  context: LogInkInputContext,
  slot: LogInkBlameInputSlot
): LogInkInputEvent[] | null {
  if (state.activeView !== 'blame') {
    return null
  }

  switch (slot) {
    // View-local top jump (#1387): `gg` moves the visible blame cursor,
    // not the hidden history cursor the generic moveToTop below drives.
    // Always handled once the view matches — an empty result still
    // swallows the keystroke rather than falling through.
    case 'jump-top':
      return context.blameLineCount
        ? [
          action({ type: 'moveBlame', delta: -context.blameLineCount, count: context.blameLineCount }),
          action({ type: 'setStatus', value: 'jumped to first line', ttl: 'echo' }),
        ]
        : []

    // View-local bottom jump (#1387) — mirror of jump-top.
    case 'jump-bottom':
      return context.blameLineCount
        ? [
          action({ type: 'moveBlame', delta: context.blameLineCount, count: context.blameLineCount }),
          action({ type: 'setStatus', value: 'jumped to last line', ttl: 'echo' }),
        ]
        : []

    // Single-line movement. Only claims the keystroke when there are
    // lines to move through — otherwise falls through (returns null) so
    // the router's shared movement chain can keep checking other views.
    case 'move-up':
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: -1, count: context.blameLineCount })]
        : null

    case 'move-down':
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: 1, count: context.blameLineCount })]
        : null

    // View-local paging (#1387) — the generic `page` fallback moves the
    // hidden history cursor beneath this surface. Always handled once
    // the view matches, mirroring jump-top/jump-bottom above.
    case 'page-up':
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: -10, count: context.blameLineCount })]
        : []

    case 'page-down':
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: 10, count: context.blameLineCount })]
        : []

    // `L` opens file-history for the path under blame.
    case 'open-file-history':
      return inputValue === 'L' && state.blamePath
        ? [action({ type: 'navigateOpenFileHistoryForPath', path: state.blamePath })]
        : null

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
