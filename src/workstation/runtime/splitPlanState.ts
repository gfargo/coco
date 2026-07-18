import type { CommitSplitPlan, CommitSplitPlanContext } from '../../commands/commit/split'

/**
 * Split-plan overlay state — sliced out of `inkViewModel.ts`'s monolith
 * (#1723), following the `themePicker.ts` pattern: state fragment +
 * action union + a pure `reduce(state, action)`.
 *
 * Held on root state (not on a per-view surface) because the overlay
 * can be triggered from compose and dismissed back to whatever view
 * was active beneath. The plan + context come from
 * `runCommitSplitPlanWorkflow`; the workstation holds them between
 * preview and apply so the executed split matches exactly what was
 * previewed.
 */
export type SplitPlanState = {
  status: 'loading' | 'ready' | 'applying'
  plan?: CommitSplitPlan
  planContext?: CommitSplitPlanContext
  scrollOffset: number
  error?: string
  /**
   * Set when the planner exhausted its retry budget and returned the
   * single-group fallback. Surfaces in the overlay header so the user
   * knows the plan they're previewing isn't a real LLM split, and in
   * the apply-time success message. Cleared when the user re-rolls
   * the planner.
   */
  fallback?: import('../../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
  /**
   * Set when a dedupe rescue silently dropped a file/hunk placement
   * the model had also put in an earlier group (#1462). Surfaces as a
   * warning banner in the overlay so a validation-clean plan doesn't
   * hide an auto-resolved placement from the user before they apply.
   */
  dedupeWarnings?: import('../../commands/commit/splitPlanValidation').DuplicateRescueNote[]
}

export type SplitPlanFields = {
  splitPlan?: SplitPlanState
}

export type SplitPlanAction =
  | { type: 'startSplitPlanLoad' }
  | {
      type: 'setSplitPlanReady'
      plan: CommitSplitPlan
      planContext: CommitSplitPlanContext
      fallback?: import('../../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
      dedupeWarnings?: import('../../commands/commit/splitPlanValidation').DuplicateRescueNote[]
    }
  | { type: 'setSplitPlanApplying' }
  | { type: 'setSplitPlanError'; error: string }
  | { type: 'pageSplitPlan'; delta: number; lineCount: number }
  | { type: 'clearSplitPlan' }

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

/**
 * Reduces the split-plan overlay. `'pageSplitPlan'` returns the fragment
 * unchanged when no plan is loaded — the root relies on that to skip its
 * `pendingKey` clear for this action too, so the guard must stay a true
 * no-op here rather than clearing anything.
 */
export function applySplitPlanAction(
  state: SplitPlanFields,
  action: SplitPlanAction
): SplitPlanFields {
  switch (action.type) {
    case 'startSplitPlanLoad':
      // Overlay opens immediately so the user sees the loading state
      // (rather than the compose view sitting frozen while the LLM
      // call resolves). plan + planContext stay undefined until ready.
      return {
        ...state,
        splitPlan: { status: 'loading', scrollOffset: 0 },
      }
    case 'setSplitPlanReady':
      return {
        ...state,
        splitPlan: {
          status: 'ready',
          plan: action.plan,
          planContext: action.planContext,
          scrollOffset: 0,
          fallback: action.fallback,
          dedupeWarnings: action.dedupeWarnings,
        },
      }
    case 'setSplitPlanApplying':
      // Preserve plan + planContext so the overlay can keep rendering
      // the same content during apply (just with a "applying…" hint
      // overlaid). If somehow this fires without a plan loaded, fall
      // back to the loading shape.
      if (!state.splitPlan?.plan || !state.splitPlan.planContext) {
        return { ...state, splitPlan: { status: 'loading', scrollOffset: 0 } }
      }
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          status: 'applying',
        },
      }
    case 'setSplitPlanError':
      // Apply / plan failure path. We KEEP the overlay open in 'ready'
      // shape with the previous plan if we have one, so the user can
      // either retry or back out without losing context. If no plan
      // yet (failure during initial load), close the overlay — there's
      // nothing to retry from. The status line carries the message
      // either way; the `error` field is for the overlay's own copy.
      if (!state.splitPlan?.plan) {
        return { ...state, splitPlan: undefined }
      }
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          status: 'ready',
          error: action.error,
        },
      }
    case 'pageSplitPlan':
      if (!state.splitPlan) return state
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          scrollOffset: clampIndex(
            state.splitPlan.scrollOffset + action.delta,
            action.lineCount
          ),
        },
      }
    case 'clearSplitPlan':
      return { ...state, splitPlan: undefined }
    default:
      return state
  }
}
