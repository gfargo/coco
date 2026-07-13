import {
  applyThemePickerAction,
  createThemePickerState,
  filterThemePresets,
  getThemePickerSelection,
} from './themePicker'

/**
 * Coverage for the theme-picker slice extracted out of `inkViewModel.ts`
 * (#1630 first slice). `inkViewModel.test.ts` keeps only the
 * composition-root-specific case (toggling closes sibling overlays,
 * which this module doesn't own) — everything else that's pure to the
 * picker's own three fields and the fuzzy-filter helpers lives here.
 */
describe('theme picker slice', () => {
  it('starts closed with a clean filter/cursor', () => {
    const state = createThemePickerState()
    expect(state.showThemePicker).toBe(false)
    expect(state.themePickerFilter).toBe('')
    expect(state.themePickerIndex).toBe(0)
  })

  it('toggleThemePicker flips open state and resets filter/cursor', () => {
    let state = createThemePickerState()
    state = applyThemePickerAction(state, { type: 'toggleThemePicker' })
    expect(state.showThemePicker).toBe(true)

    state = applyThemePickerAction(state, { type: 'toggleThemePicker' })
    expect(state.showThemePicker).toBe(false)
  })

  it('fuzzy-filters presets case-insensitively', () => {
    expect(filterThemePresets('')).toContain('catppuccin')
    // Exact substring still matches…
    expect(filterThemePresets('TOKYO')).toContain('tokyo-night')
    // …and a non-contiguous subsequence matches too.
    const gl = filterThemePresets('gl')
    expect(gl).toContain('gruvbox-light')
    expect(gl).toContain('github-light')
    // Nonsense query that can't appear as a subsequence → no matches.
    expect(filterThemePresets('definitely-not-a-theme')).toHaveLength(0)
  })

  it('ranks the best fuzzy match first', () => {
    // Exact preset id outranks the longer one that merely contains it.
    const gruvbox = filterThemePresets('gruvbox')
    expect(gruvbox[0]).toBe('gruvbox')
    expect(gruvbox).toContain('gruvbox-light')
    // Word-segment matches (after `-`) rank ahead of incidental ones.
    const cm = filterThemePresets('cm')
    expect(cm[0]).toBe('catppuccin-macchiato')
  })

  it('moveThemePicker clamps the cursor to the filtered list', () => {
    let state = createThemePickerState()
    const count = filterThemePresets('').length

    state = applyThemePickerAction(state, { type: 'moveThemePicker', delta: -1, presetCount: count })
    expect(state.themePickerIndex).toBe(0) // clamped at the top

    state = applyThemePickerAction(state, { type: 'moveThemePicker', delta: 999, presetCount: count })
    expect(state.themePickerIndex).toBe(count - 1) // clamped at the bottom
  })

  it('typing into the filter resets the cursor and getThemePickerSelection follows it', () => {
    let state = createThemePickerState()
    state = applyThemePickerAction(state, { type: 'moveThemePicker', delta: 3, presetCount: 50 })
    expect(state.themePickerIndex).toBe(3)

    state = applyThemePickerAction(state, { type: 'appendThemePickerFilter', value: 'gruvbox' })
    expect(state.themePickerFilter).toBe('gruvbox')
    expect(state.themePickerIndex).toBe(0)
    expect(getThemePickerSelection(state)).toBe('gruvbox')

    state = applyThemePickerAction(state, { type: 'backspaceThemePickerFilter' })
    expect(state.themePickerFilter).toBe('gruvbo')

    state = applyThemePickerAction(state, { type: 'clearThemePickerFilter' })
    expect(state.themePickerFilter).toBe('')
    expect(state.themePickerIndex).toBe(0)
  })

  it('getThemePickerSelection is undefined when nothing matches', () => {
    let state = createThemePickerState()
    state = applyThemePickerAction(state, { type: 'appendThemePickerFilter', value: 'zzzzz' })
    expect(getThemePickerSelection(state)).toBeUndefined()
  })
})
