import { getLogInkThemePresets, type LogInkThemePreset } from '../chrome/theme'

/**
 * Theme picker (`gC`) interaction state — the first per-surface slice
 * pulled out of `inkViewModel.ts`'s monolith (#1630), following the
 * `commitCompose.ts` pattern: state fragment + action union + a pure
 * `reduce(state, action)`.
 *
 * Unlike `commitCompose.ts`, these fields stay flat on `LogInkState`
 * rather than nested under a `themePicker` sub-object — 13 call sites
 * read `state.showThemePicker` / `themePickerFilter` / `themePickerIndex`
 * directly (renderers, the input router, the workspace surface's own
 * mirrored state), and nesting would churn all of them for no behavior
 * change. `applyLogInkAction`'s `'toggleThemePicker'` case also closes
 * OTHER overlays (help / view-keys / command palette) — that
 * exclusivity is genuinely global state, so it stays in the composition
 * root; this module only owns the picker's own three fields.
 */
export type ThemePickerFields = {
  showThemePicker: boolean
  themePickerFilter: string
  themePickerIndex: number
}

export type ThemePickerAction =
  | { type: 'toggleThemePicker' }
  | { type: 'moveThemePicker'; delta: number; presetCount: number }
  | { type: 'appendThemePickerFilter'; value: string }
  | { type: 'backspaceThemePickerFilter' }
  | { type: 'clearThemePickerFilter' }

export function createThemePickerState(): ThemePickerFields {
  return {
    showThemePicker: false,
    themePickerFilter: '',
    themePickerIndex: 0,
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

/**
 * Reduces the picker's own three fields. `'toggleThemePicker'` here only
 * flips `showThemePicker` and resets the filter/cursor — the composition
 * root additionally closes sibling overlays on the same action before
 * merging this result back in.
 */
export function applyThemePickerAction(
  state: ThemePickerFields,
  action: ThemePickerAction
): ThemePickerFields {
  switch (action.type) {
    case 'toggleThemePicker':
      return {
        ...state,
        showThemePicker: !state.showThemePicker,
        themePickerFilter: '',
        themePickerIndex: 0,
      }
    case 'moveThemePicker':
      return {
        ...state,
        themePickerIndex: clampIndex(
          state.themePickerIndex + action.delta,
          action.presetCount
        ),
      }
    case 'appendThemePickerFilter':
      return {
        ...state,
        themePickerFilter: `${state.themePickerFilter}${action.value}`,
        themePickerIndex: 0,
      }
    case 'backspaceThemePickerFilter':
      return {
        ...state,
        themePickerFilter: state.themePickerFilter.slice(0, -1),
        themePickerIndex: 0,
      }
    case 'clearThemePickerFilter':
      return {
        ...state,
        themePickerFilter: '',
        themePickerIndex: 0,
      }
    default:
      return state
  }
}

/**
 * Fuzzy (subsequence) score for a preset id against a lowercase query.
 * Returns `null` when the query chars don't appear in order; otherwise a
 * score where contiguous runs, a start-of-string match, and matches right
 * after a `-` separator are rewarded — so `gl` ranks `gruvbox-light` /
 * `github-light` above incidental matches, and `tn` finds `tokyo-night`.
 */
function fuzzyScoreThemePreset(preset: string, query: string): number | null {
  const target = preset.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatch = -2
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) {
      score += 1
      if (i === lastMatch + 1) score += 4 // contiguous run
      if (i === 0) score += 8 // matches the very start
      else if (target[i - 1] === '-') score += 4 // start of a word segment
      lastMatch = i
      qi += 1
    }
  }
  return qi === query.length ? score : null
}

/**
 * Filter the full preset list by a fuzzy (subsequence) query, ranked best
 * match first (ties broken by catalog order). An empty query returns every
 * preset in catalog order. Shared by the theme picker overlay renderer, the
 * input handler (for cursor bounds), and the live-preview selector so all
 * three agree on the same filtered list.
 */
export function filterThemePresets(filter: string): LogInkThemePreset[] {
  const query = filter.trim().toLowerCase()
  const all = getLogInkThemePresets()
  if (!query) {
    return all
  }
  return all
    .map((preset, index) => ({ preset, index, score: fuzzyScoreThemePreset(preset, query) }))
    .filter((entry): entry is { preset: LogInkThemePreset; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.preset)
}

/**
 * The preset currently under the theme-picker cursor (clamped to the
 * filtered list). `undefined` when the filter matches nothing.
 */
export function getThemePickerSelection(state: ThemePickerFields): LogInkThemePreset | undefined {
  return getThemePickerSelectionFor(state.themePickerFilter, state.themePickerIndex)
}

/**
 * State-model-agnostic variant: the preset under the picker cursor for a
 * raw `filter` + `index`. Used by the workspace top-level surface, which
 * keeps its own state shape but shares the picker filtering.
 */
export function getThemePickerSelectionFor(
  filter: string,
  index: number
): LogInkThemePreset | undefined {
  const filtered = filterThemePresets(filter)
  if (filtered.length === 0) {
    return undefined
  }
  return filtered[clampIndex(index, filtered.length)]
}
