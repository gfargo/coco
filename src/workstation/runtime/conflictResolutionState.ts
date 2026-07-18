import type { ConflictRegion } from '../../git/conflictRegionActions'

/**
 * AI conflict-resolution session state — sliced out of
 * `inkViewModel.ts`'s monolith (#1723), following the `themePicker.ts`
 * pattern: state fragment + action union + a pure `reduce(state, action)`.
 *
 * Per-region proposals for ONE conflicted file, held between generation
 * and the explicit per-region accept/edit/reject (#1369). The
 * navigation-abandon logic (`withAbandonedConflictResolution`) stays in
 * the composition root since it reacts to view changes, not to actions
 * this slice owns.
 */
export type LogInkConflictProposal = {
  regionIndex: number
  resolution: string
  rationale: string
  status: 'pending' | 'accepted' | 'rejected'
  /**
   * Region snapshot at generation time — the display source for the
   * ours/theirs blocks AND the content-matched identity the apply path
   * uses (line numbers shift as earlier regions are accepted).
   */
  region: ConflictRegion
}

export type LogInkConflictResolutionState = {
  path: string
  status: 'loading' | 'ready' | 'error'
  error?: string
  proposals: LogInkConflictProposal[]
  selectedIndex: number
}

export type ConflictResolutionFields = {
  conflictResolution?: LogInkConflictResolutionState
}

export type ConflictResolutionAction =
  | { type: 'setConflictResolutionLoading'; path: string }
  | {
    type: 'setConflictResolutionReady'
    path: string
    proposals: Array<Omit<LogInkConflictProposal, 'status'>>
  }
  | { type: 'setConflictResolutionError'; path: string; error: string }
  | { type: 'moveConflictProposal'; delta: number }
  | {
    type: 'setConflictProposalStatus'
    regionIndex: number
    status: 'accepted' | 'rejected'
    /** Replacement text when an $EDITOR edit changed the proposal before accept. */
    resolution?: string
  }
  | { type: 'clearConflictResolution' }

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

export function applyConflictResolutionAction(
  state: ConflictResolutionFields,
  action: ConflictResolutionAction
): ConflictResolutionFields {
  switch (action.type) {
    case 'setConflictResolutionLoading':
      return {
        ...state,
        conflictResolution: { path: action.path, status: 'loading', proposals: [], selectedIndex: 0 },
      }
    case 'setConflictResolutionReady':
      return {
        ...state,
        conflictResolution: {
          path: action.path,
          status: 'ready',
          proposals: action.proposals.map((proposal) => ({ ...proposal, status: 'pending' as const })),
          selectedIndex: 0,
        },
      }
    case 'setConflictResolutionError':
      return {
        ...state,
        conflictResolution: {
          path: action.path,
          status: 'error',
          error: action.error,
          proposals: [],
          selectedIndex: 0,
        },
      }
    case 'moveConflictProposal': {
      const session = state.conflictResolution
      if (!session || session.proposals.length === 0) {
        return state
      }
      return {
        ...state,
        conflictResolution: {
          ...session,
          selectedIndex: clampIndex(session.selectedIndex + action.delta, session.proposals.length),
        },
      }
    }
    case 'setConflictProposalStatus': {
      const session = state.conflictResolution
      if (!session) {
        return state
      }
      const proposals = session.proposals.map((proposal) =>
        proposal.regionIndex === action.regionIndex
          ? {
            ...proposal,
            status: action.status,
            resolution: action.resolution ?? proposal.resolution,
          }
          : proposal
      )
      // Advance the cursor to the next still-pending proposal so the
      // y/y/y flow walks the file without manual j presses.
      const nextPending = proposals.findIndex(
        (proposal, index) => index > session.selectedIndex && proposal.status === 'pending'
      )
      const anyPending = proposals.findIndex((proposal) => proposal.status === 'pending')
      const selectedIndex = nextPending !== -1
        ? nextPending
        : anyPending !== -1
          ? anyPending
          : session.selectedIndex
      return {
        ...state,
        conflictResolution: { ...session, proposals, selectedIndex },
      }
    }
    case 'clearConflictResolution':
      return { ...state, conflictResolution: undefined }
    default:
      return state
  }
}
