import {
  applyCommandPaletteAction,
  createCommandPaletteState,
} from './commandPaletteState'

/**
 * Coverage for the command-palette slice extracted out of
 * `inkViewModel.ts` (#1723). Pure to `paletteFilter` /
 * `paletteSelectedIndex` / `paletteRecent`; the composition root only
 * wires `pendingKey` clearing, the `showCommandPalette` flip, and
 * closing sibling overlays (help, view-keys), covered in
 * `inkViewModel.test.ts`.
 */
describe('command palette slice', () => {
  it('starts with an empty filter, cursor at 0, and no recents', () => {
    const state = createCommandPaletteState()
    expect(state).toEqual({
      paletteFilter: '',
      paletteSelectedIndex: 0,
      paletteRecent: [],
    })
  })

  it('toggleCommandPalette resets the filter and cursor', () => {
    let state = createCommandPaletteState()
    state = applyCommandPaletteAction(state, { type: 'appendPaletteFilter', value: 'br' })
    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 2, commandCount: 5 })
    expect(state.paletteFilter).toBe('br')
    expect(state.paletteSelectedIndex).toBe(2)

    state = applyCommandPaletteAction(state, { type: 'toggleCommandPalette' })
    expect(state.paletteFilter).toBe('')
    expect(state.paletteSelectedIndex).toBe(0)
  })

  it('appendPaletteFilter/backspacePaletteFilter edit the filter and reset the cursor', () => {
    let state = createCommandPaletteState()
    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 3, commandCount: 10 })
    state = applyCommandPaletteAction(state, { type: 'appendPaletteFilter', value: 'ch' })
    expect(state.paletteFilter).toBe('ch')
    expect(state.paletteSelectedIndex).toBe(0)

    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 1, commandCount: 10 })
    state = applyCommandPaletteAction(state, { type: 'backspacePaletteFilter' })
    expect(state.paletteFilter).toBe('c')
    expect(state.paletteSelectedIndex).toBe(0)
  })

  it('clearPaletteFilter wipes the filter and resets the cursor', () => {
    let state = createCommandPaletteState()
    state = applyCommandPaletteAction(state, { type: 'appendPaletteFilter', value: 'checkout' })
    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 2, commandCount: 10 })
    state = applyCommandPaletteAction(state, { type: 'clearPaletteFilter' })
    expect(state.paletteFilter).toBe('')
    expect(state.paletteSelectedIndex).toBe(0)
  })

  it('movePaletteSelection clamps to the command list bounds', () => {
    let state = createCommandPaletteState()
    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 10, commandCount: 3 })
    expect(state.paletteSelectedIndex).toBe(2)

    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: -10, commandCount: 3 })
    expect(state.paletteSelectedIndex).toBe(0)

    // An empty command list clamps to 0.
    state = applyCommandPaletteAction(state, { type: 'movePaletteSelection', delta: 1, commandCount: 0 })
    expect(state.paletteSelectedIndex).toBe(0)
  })

  it('recordPaletteRecent dedupes and caps the recent list at 8, newest first', () => {
    let state = createCommandPaletteState()
    for (const id of ['a', 'b', 'c']) {
      state = applyCommandPaletteAction(state, { type: 'recordPaletteRecent', value: id })
    }
    expect(state.paletteRecent).toEqual(['c', 'b', 'a'])

    // Re-recording an existing entry floats it to the front instead of duplicating.
    state = applyCommandPaletteAction(state, { type: 'recordPaletteRecent', value: 'a' })
    expect(state.paletteRecent).toEqual(['a', 'c', 'b'])

    for (const id of ['d', 'e', 'f', 'g', 'h', 'i']) {
      state = applyCommandPaletteAction(state, { type: 'recordPaletteRecent', value: id })
    }
    expect(state.paletteRecent).toHaveLength(8)
    expect(state.paletteRecent[0]).toBe('i')
  })
})
