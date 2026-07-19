import {
  applyHelpOverlayAction,
  createHelpOverlayState,
} from './helpOverlayState'

/**
 * Coverage for the help-overlay slice extracted out of `inkViewModel.ts`
 * (#1723). Pure to `showHelp` / `helpScrollOffset` / `helpFilter` /
 * `helpFilterMode`; the composition root only wires `pendingKey`
 * clearing and closing sibling overlays (view-keys strip, command
 * palette), covered in `inkViewModel.test.ts`.
 */
describe('help overlay slice', () => {
  it('starts closed with scroll/filter reset', () => {
    const state = createHelpOverlayState()
    expect(state).toEqual({
      showHelp: false,
      helpScrollOffset: 0,
      helpFilter: '',
      helpFilterMode: false,
    })
  })

  it('toggleHelp flips showHelp and resets scroll/filter either direction', () => {
    let state = createHelpOverlayState()
    state = applyHelpOverlayAction(state, { type: 'toggleHelp' })
    expect(state.showHelp).toBe(true)

    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: 5 })
    expect(state.helpScrollOffset).toBe(5)

    state = applyHelpOverlayAction(state, { type: 'toggleHelp' })
    expect(state.showHelp).toBe(false)
    expect(state.helpScrollOffset).toBe(0)

    state = applyHelpOverlayAction(state, { type: 'toggleHelp' })
    expect(state.showHelp).toBe(true)
    expect(state.helpScrollOffset).toBe(0)
  })

  it('scrollHelp floor-clamps at 0 (no negative offsets, no upper bound)', () => {
    let state = applyHelpOverlayAction(createHelpOverlayState(), { type: 'toggleHelp' })
    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: -3 })
    expect(state.helpScrollOffset).toBe(0)

    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: 7 })
    expect(state.helpScrollOffset).toBe(7)

    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: -100 })
    expect(state.helpScrollOffset).toBe(0)
  })

  it('openHelpFilter enters filter mode without touching the filter text', () => {
    const state = applyHelpOverlayAction(createHelpOverlayState(), { type: 'openHelpFilter' })
    expect(state.helpFilterMode).toBe(true)
    expect(state.helpFilter).toBe('')
  })

  it('appendHelpFilter/backspaceHelpFilter edit the filter and reset scroll', () => {
    let state = createHelpOverlayState()
    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: 4 })
    state = applyHelpOverlayAction(state, { type: 'appendHelpFilter', value: 'reb' })
    expect(state.helpFilter).toBe('reb')
    expect(state.helpScrollOffset).toBe(0)

    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: 2 })
    state = applyHelpOverlayAction(state, { type: 'backspaceHelpFilter' })
    expect(state.helpFilter).toBe('re')
    expect(state.helpScrollOffset).toBe(0)
  })

  it('commitHelpFilter keeps the filter text but exits filter mode', () => {
    let state = createHelpOverlayState()
    state = applyHelpOverlayAction(state, { type: 'openHelpFilter' })
    state = applyHelpOverlayAction(state, { type: 'appendHelpFilter', value: 'reb' })
    state = applyHelpOverlayAction(state, { type: 'commitHelpFilter' })
    expect(state.helpFilterMode).toBe(false)
    expect(state.helpFilter).toBe('reb')
  })

  it('clearHelpFilter wipes the filter, exits filter mode, and resets scroll', () => {
    let state = createHelpOverlayState()
    state = applyHelpOverlayAction(state, { type: 'openHelpFilter' })
    state = applyHelpOverlayAction(state, { type: 'appendHelpFilter', value: 'reb' })
    state = applyHelpOverlayAction(state, { type: 'scrollHelp', delta: 3 })
    state = applyHelpOverlayAction(state, { type: 'clearHelpFilter' })
    expect(state.helpFilter).toBe('')
    expect(state.helpFilterMode).toBe(false)
    expect(state.helpScrollOffset).toBe(0)
  })
})
