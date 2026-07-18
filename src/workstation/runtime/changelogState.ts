/**
 * Changelog view (`gh`) interaction state — sliced out of
 * `inkViewModel.ts`'s monolith (#1723), following the `themePicker.ts`
 * pattern: state fragment + action union + a pure `reduce(state, action)`.
 *
 * Fields stay flat on `LogInkState` (not nested) since the reducer's
 * root already threads `changelogView`/`changelogCache` through several
 * other cases (`createLogInkState`, cache eviction on session reset).
 */
export type ChangelogViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ChangelogViewState = {
  status: ChangelogViewStatus
  text?: string
  error?: string
  branch?: string
  baseLabel?: string
  scrollOffset: number
}

export type ChangelogCacheEntry = {
  text: string
  baseLabel: string
  generatedAt: number
}

export const DEFAULT_CHANGELOG_VIEW_STATE: ChangelogViewState = {
  status: 'idle',
  scrollOffset: 0,
}

export type ChangelogFields = {
  changelogView: ChangelogViewState
  changelogCache: { [branch: string]: ChangelogCacheEntry }
}

export type ChangelogAction =
  | { type: 'setChangelogLoading'; branch: string; baseLabel: string }
  | { type: 'setChangelogReady'; branch: string; baseLabel: string; text: string; generatedAt: number }
  | { type: 'setChangelogError'; branch: string; baseLabel: string; error: string }
  | { type: 'setChangelogText'; text: string; generatedAt: number }
  | { type: 'pageChangelog'; delta: number; lineCount: number }
  | { type: 'clearChangelogCache'; branch?: string }

export function createChangelogState(): ChangelogFields {
  return {
    changelogView: { ...DEFAULT_CHANGELOG_VIEW_STATE },
    changelogCache: {},
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

/**
 * Reduces the changelog view + cache. `'setChangelogText'` returns the
 * fragment unchanged (no-op) when the view isn't `'ready'` — the root
 * relies on that to skip its `pendingKey` clear for this action too, so
 * the guard must stay a true no-op here rather than clearing anything.
 */
export function applyChangelogAction(
  state: ChangelogFields,
  action: ChangelogAction
): ChangelogFields {
  switch (action.type) {
    case 'setChangelogLoading':
      return {
        ...state,
        changelogView: {
          status: 'loading',
          branch: action.branch,
          baseLabel: action.baseLabel,
          scrollOffset: 0,
        },
      }
    case 'setChangelogReady': {
      // Cache the result so re-entry (or `c` to PR) reuses it instead of
      // re-running the LLM. Keyed by branch so a checkout naturally
      // produces a fresh generation.
      const cached: ChangelogCacheEntry = {
        text: action.text,
        baseLabel: action.baseLabel,
        generatedAt: action.generatedAt,
      }
      return {
        ...state,
        changelogView: {
          status: 'ready',
          text: action.text,
          branch: action.branch,
          baseLabel: action.baseLabel,
          scrollOffset: 0,
        },
        changelogCache: {
          ...state.changelogCache,
          [action.branch]: cached,
        },
      }
    }
    case 'setChangelogError':
      return {
        ...state,
        changelogView: {
          status: 'error',
          branch: action.branch,
          baseLabel: action.baseLabel,
          error: action.error,
          scrollOffset: 0,
        },
      }
    case 'setChangelogText': {
      // Used by the $EDITOR round-trip: user edits the cached text, we
      // update the view AND the cache entry so subsequent re-entry
      // reflects the edits. Branch key is taken from the current view
      // (which is what the user just edited against).
      if (state.changelogView.status !== 'ready' || !state.changelogView.branch) {
        return state
      }
      const branch = state.changelogView.branch
      const existing = state.changelogCache[branch]
      return {
        ...state,
        changelogView: {
          ...state.changelogView,
          text: action.text,
        },
        changelogCache: {
          ...state.changelogCache,
          [branch]: {
            text: action.text,
            baseLabel: existing?.baseLabel || state.changelogView.baseLabel || '',
            // Updated-at timestamp reflects the edit. Not the original
            // generation time — `r` (regenerate) is the explicit knob
            // for "I want fresh LLM output, not my edits".
            generatedAt: action.generatedAt,
          },
        },
      }
    }
    case 'pageChangelog':
      return {
        ...state,
        changelogView: {
          ...state.changelogView,
          scrollOffset: clampIndex(
            state.changelogView.scrollOffset + action.delta,
            action.lineCount
          ),
        },
      }
    case 'clearChangelogCache': {
      // Targeted clear for a single branch, or wholesale wipe when
      // `branch` is omitted. Wholesale used on session reset / config
      // change; targeted reserved for future "this generation looks
      // wrong, drop it" UX.
      if (!action.branch) {
        return { ...state, changelogCache: {} }
      }
      const next = { ...state.changelogCache }
      delete next[action.branch]
      return { ...state, changelogCache: next }
    }
    default:
      return state
  }
}
