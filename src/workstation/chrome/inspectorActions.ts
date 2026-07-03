/**
 * Hardcoded per-entity action lists surfaced inside the right-hand
 * inspector panel. The inspector used to repeat the repo / branch /
 * status content the top header and left sidebar already show; we drop
 * that trailer in favor of an actionable cheat-sheet so the user knows
 * exactly which keystrokes apply to whatever they have under the cursor.
 *
 * Why hardcoded instead of introspecting `LOG_INK_KEY_BINDINGS`:
 *   - Most per-entity actions live in `inkInput.ts` as direct keystroke
 *     handlers (e.g. `c` cherry-pick, `R` revert) rather than as
 *     globally-registered bindings, so the registry would be a partial
 *     view at best.
 *   - The bindings registry's `contexts` model (normal / search / focus
 *     name) does not cleanly map to inspector entity types like "branch"
 *     or "tag". Filtering it would mean replicating the same per-view
 *     scoping logic the input dispatcher already encodes.
 *   - New per-entity actions are added infrequently — the maintenance
 *     cost of mirroring them here is low and keeps this file the single
 *     source of truth for "what shows in the inspector".
 *
 * If you wire up a new per-entity keystroke in `inkInput.ts` — for
 * example a "create branch from this commit" or "create tag from this
 * commit" action — add the matching row to the relevant array below so
 * it shows up in the inspector automatically.
 */

export type InspectorAction = {
  /** Key label shown in the inspector. Use the literal keystroke
   *  (`c`, `R`, `gp`, `enter`). */
  key: string
  /** Human-readable description of what the keystroke does. */
  label: string
  /** Marks irreversible / destructive ops so the inspector can paint
   *  them with `theme.colors.danger` and a `[!]` marker. */
  destructive?: boolean
}

export type InspectorActionContext =
  | 'history-commit'
  | 'branch'
  | 'tag'
  | 'stash'
  | 'worktree'

const HISTORY_COMMIT_ACTIONS: InspectorAction[] = [
  { key: 'enter', label: 'Open diff' },
  { key: 'c', label: 'Cherry-pick' },
  { key: 'R', label: 'Revert', destructive: true },
  { key: 'Z', label: 'Reset to commit', destructive: true },
  { key: 'i', label: 'Interactive rebase', destructive: true },
  { key: 'f', label: 'Fixup staged into commit' },
  { key: 'y', label: 'Yank hash' },
  { key: 'Y', label: 'Yank short hash' },
  { key: 'O', label: 'Open in browser' },
]

const BRANCH_ACTIONS: InspectorAction[] = [
  { key: 'enter', label: 'Checkout' },
  { key: '+', label: 'New branch' },
  { key: 'R', label: 'Rename' },
  { key: 'u', label: 'Set upstream' },
  { key: 'D', label: 'Delete', destructive: true },
  { key: 'P', label: 'Push current' },
  { key: 'F', label: 'Fetch all' },
  { key: 'y', label: 'Yank name' },
]

const TAG_ACTIONS: InspectorAction[] = [
  { key: '+', label: 'New tag' },
  { key: 'P', label: 'Push tag' },
  { key: 'T', label: 'Delete', destructive: true },
  { key: 'R', label: 'Delete remote', destructive: true },
  { key: 'y', label: 'Yank name' },
]

const STASH_ACTIONS: InspectorAction[] = [
  { key: 'enter', label: 'Open diff' },
  { key: 'a', label: 'Apply' },
  { key: 'p', label: 'Pop' },
  { key: 'X', label: 'Drop', destructive: true },
  { key: 'y', label: 'Yank ref' },
]

const WORKTREE_ACTIONS: InspectorAction[] = [
  { key: 'W', label: 'Remove', destructive: true },
  { key: 'y', label: 'Yank path' },
]

export function getInspectorActions(
  context: InspectorActionContext
): InspectorAction[] {
  switch (context) {
    case 'history-commit':
      return HISTORY_COMMIT_ACTIONS
    case 'branch':
      return BRANCH_ACTIONS
    case 'tag':
      return TAG_ACTIONS
    case 'stash':
      return STASH_ACTIONS
    case 'worktree':
      return WORKTREE_ACTIONS
    default: {
      const exhaustive: never = context
      throw new Error(`Unhandled inspector action context: ${String(exhaustive)}`)
    }
  }
}
