import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * Conflicts view input handlers (#1369 / #COCO-1064), consolidated out of
 * `inkInput.ts`'s router. Unlike the bisect extraction (#1625), these ten
 * branches are NOT contiguous in the router: an AI-session modal sits
 * above the chord-cancel and bisect delegation, while the movement,
 * Enter, and per-row-action branches sit below — interleaved with live
 * non-conflicts handlers (worktree/PR-triage movement, other views'
 * `o`/`C` bindings) that must keep firing at their original precedence.
 * Merging everything into one call would hoist the lower branches above
 * that interleaved logic, so the router calls this function once per
 * `slot`, at each original branch's exact original position.
 */
export type LogInkConflictsInputSlot = 'session' | 'move' | 'enter' | 'row-action'

export function handleConflictsInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  context: LogInkInputContext,
  slot: LogInkConflictsInputSlot
): LogInkInputEvent[] | null {
  if (state.activeView !== 'conflicts') {
    return null
  }

  switch (slot) {
    case 'session': {
      // AI conflict-resolution session (#1369). While proposals are open
      // on the conflicts view they own the review keys: j/k walk regions,
      // y/e/n act on the cursored one, Y accepts everything pending, Esc
      // dismisses. The file is untouched until an explicit accept. Sits
      // ABOVE the global Esc-pop and single-letter fallbacks (`n` = move,
      // `y` = yank) so the review keys can't leak into navigation.
      if (!state.conflictResolution) {
        return null
      }
      const session = state.conflictResolution
      if (session.status === 'ready' && session.proposals.length > 0) {
        if (key.downArrow || inputValue === 'j') {
          return [action({ type: 'moveConflictProposal', delta: 1 })]
        }
        if (key.upArrow || inputValue === 'k') {
          return [action({ type: 'moveConflictProposal', delta: -1 })]
        }
        if (inputValue === 'y' && !key.ctrl && !key.meta) {
          return [{ type: 'acceptConflictProposal' }]
        }
        if (inputValue === 'Y' && !key.ctrl && !key.meta) {
          return [{ type: 'acceptAllConflictProposals' }]
        }
        if (inputValue === 'e' && !key.ctrl && !key.meta) {
          return [{ type: 'editConflictProposal' }]
        }
        if (inputValue === 'n' && !key.ctrl && !key.meta) {
          const proposal = session.proposals[session.selectedIndex]
          return proposal && proposal.status === 'pending'
            ? [action({
              type: 'setConflictProposalStatus',
              regionIndex: proposal.regionIndex,
              status: 'rejected',
            })]
            : []
        }
        if (key.escape) {
          return [
            action({ type: 'clearConflictResolution' }),
            action({ type: 'setStatus', value: 'Proposals dismissed — file untouched.' }),
          ]
        }
      }
      if (session.status === 'error' && key.escape) {
        return [action({ type: 'clearConflictResolution' })]
      }
      return null
    }

    case 'move': {
      // Called from within the router's ↑/k and ↓/j blocks respectively —
      // the direction is derived here so the same slot serves both call
      // sites without duplicating the count guard.
      if (!context.conflictFileCount) {
        return null
      }
      if (key.upArrow || inputValue === 'k') {
        return [action({ type: 'moveConflictFile', delta: -1, count: context.conflictFileCount })]
      }
      if (key.downArrow || inputValue === 'j') {
        return [action({ type: 'moveConflictFile', delta: 1, count: context.conflictFileCount })]
      }
      return null
    }

    case 'enter': {
      // Enter on a conflict file opens the worktree diff for that file so
      // the user can inspect the conflict markers in context.
      if (key.return && context.conflictFileCount && context.conflictSelectedPath) {
        return [{ type: 'runWorkflowAction', id: 'resolve-conflict-open-diff', payload: context.conflictSelectedPath }]
      }
      return null
    }

    case 'row-action': {
      // `o` opens the conflicted file in $EDITOR for manual resolution.
      if (inputValue === 'o' && context.conflictFileCount && context.conflictSelectedPath) {
        return [{ type: 'openFileInEditor', path: context.conflictSelectedPath }]
      }
      // `s` stages the conflicted file (marks it resolved).
      if (inputValue === 's' && context.conflictFileCount && context.conflictSelectedPath) {
        return [{ type: 'runWorkflowAction', id: 'resolve-conflict-stage', payload: context.conflictSelectedPath }]
      }
      // `u` resolves by keeping theirs (incoming changes).
      if (inputValue === 'u' && context.conflictFileCount && context.conflictSelectedPath) {
        return [{ type: 'runWorkflowAction', id: 'resolve-conflict-theirs', payload: context.conflictSelectedPath }]
      }
      // `U` resolves by keeping ours (current branch).
      if (inputValue === 'U' && context.conflictFileCount && context.conflictSelectedPath) {
        return [{ type: 'runWorkflowAction', id: 'resolve-conflict-ours', payload: context.conflictSelectedPath }]
      }
      // `C` continues the in-progress operation (available when no conflicts remain).
      if (inputValue === 'C' && context.conflictFileCount === 0) {
        return [{ type: 'runWorkflowAction', id: 'continue-operation' }]
      }
      // Always intercept `C` on the conflicts view to prevent fallthrough to
      // the global `C` (Create PR) binding when conflicts remain.
      if (inputValue === 'C') {
        return [action({ type: 'setStatus', value: 'Resolve all conflicts before continuing', kind: 'warning' })]
      }
      return null
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
