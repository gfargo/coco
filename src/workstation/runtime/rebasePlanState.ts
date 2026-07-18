import type { RebasePlanRow, RebaseTodoAction } from '../../git/rebasePlanActions'

/**
 * Interactive rebase-plan overlay state (#1359) — sliced out of
 * `inkViewModel.ts`'s monolith (#1723), following the `themePicker.ts`
 * pattern: state fragment + action union + a pure `reduce(state, action)`.
 *
 * `openRebasePlan` itself stays a composition-root case (not part of
 * this module's action union): it couples to the view stack via
 * `withPushedView(state, 'rebase')`, which this slice has no business
 * knowing about. The root pushes the view, then sets `rebasePlan` using
 * the same shape this module's other actions maintain. Likewise,
 * dropping the plan on lateral navigation / popView
 * (`withAbandonedRebasePlan`) is a view-stack concern and stays in root.
 */
export type LogInkRebasePlan = {
  rows: RebasePlanRow[]
  selectedIndex: number
}

export type RebasePlanFields = {
  rebasePlan?: LogInkRebasePlan
}

export type RebasePlanAction =
  | { type: 'moveRebaseCursor'; delta: number }
  | { type: 'setRebaseAction'; action: RebaseTodoAction }
  | { type: 'moveRebaseRow'; delta: number }
  | { type: 'setRebaseRewordMessage'; message: string }
  | { type: 'clearRebasePlan' }

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

/**
 * Reduces the rebase plan's own rows/cursor. Every action guards on a
 * missing (or, for the cursor move, empty) plan and returns the fragment
 * unchanged — the root relies on that true no-op to skip its
 * `pendingKey` clear too, mirroring `pageSplitPlan`/`setChangelogText`.
 */
export function applyRebasePlanAction(
  state: RebasePlanFields,
  action: RebasePlanAction
): RebasePlanFields {
  switch (action.type) {
    case 'moveRebaseCursor': {
      const plan = state.rebasePlan
      if (!plan || plan.rows.length === 0) return state
      return {
        ...state,
        rebasePlan: {
          ...plan,
          selectedIndex: clampIndex(plan.selectedIndex + action.delta, plan.rows.length),
        },
      }
    }
    case 'setRebaseAction': {
      const plan = state.rebasePlan
      const row = plan?.rows[plan.selectedIndex]
      if (!plan || !row) return state
      // Retagging away from reword drops the stashed message so a later
      // re-reword starts fresh instead of resurrecting stale text.
      const rows = plan.rows.map((entry, index) => (
        index === plan.selectedIndex
          ? { ...entry, action: action.action, newMessage: action.action === 'reword' ? entry.newMessage : undefined }
          : entry
      ))
      return { ...state, rebasePlan: { ...plan, rows } }
    }
    case 'moveRebaseRow': {
      const plan = state.rebasePlan
      if (!plan) return state
      const from = plan.selectedIndex
      const to = from + action.delta
      if (to < 0 || to >= plan.rows.length) return state
      const rows = [...plan.rows]
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      return { ...state, rebasePlan: { rows, selectedIndex: to } }
    }
    case 'setRebaseRewordMessage': {
      const plan = state.rebasePlan
      const row = plan?.rows[plan.selectedIndex]
      if (!plan || !row) return state
      const message = action.message.trim()
      if (!message) return state
      const rows = plan.rows.map((entry, index) => (
        index === plan.selectedIndex
          ? { ...entry, action: 'reword' as const, newMessage: message }
          : entry
      ))
      return { ...state, rebasePlan: { ...plan, rows } }
    }
    case 'clearRebasePlan':
      return { ...state, rebasePlan: undefined }
    default:
      return state
  }
}
