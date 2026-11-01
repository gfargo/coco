import { deriveGitignoreOptions } from '../chrome/gitignore'
import { filterLogInkPaletteCommands, getLogInkPaletteCommands } from './inkKeymap'
import { getLogInkPaletteExecuteEvents } from './inkInput'
import { createLogInkState, type LogInkState } from './inkViewModel'
import { handleOverlayInput } from './overlayInput'
import { resolveQuitEvents } from './quitGuard'
import { filterThemePresets, getThemePickerSelection } from './themePicker'

// #2222. While an overlay is open it owns the keyboard: a key that leaks past
// it lands in the view behind (a `y` in a confirm, a `j` moving a cursor the
// user cannot see), and a key it swallows wrongly is a dead overlay. So these
// pin, per overlay, what each key does, that everything else is consumed, and
// the order the overlays take precedence in.
type Key = Record<string, unknown>

const stateWith = (over: Record<string, unknown>): LogInkState => ({ ...createLogInkState([]), ...over }) as LogInkState
const press = (state: LogInkState, input: string, key: Key = {}) => handleOverlayInput(state, input, key, {})
const actions = (events: ReturnType<typeof handleOverlayInput>) =>
  (events ?? []).map((event) => (event.type === 'action' ? event.action : event))

describe('handleOverlayInput (#2222)', () => {
  it('returns null when no overlay is open, so the router carries on', () => {
    expect(press(stateWith({}), 'j')).toBeNull()
    expect(press(stateWith({}), '', { escape: true })).toBeNull()
  })

  describe('theme picker', () => {
    const open = (over: Record<string, unknown> = {}) => stateWith({ showThemePicker: true, themePickerFilter: '', themePickerIndex: 0, ...over })

    it('closes on Esc, but clears a typed filter first', () => {
      expect(actions(press(open(), '', { escape: true }))).toEqual([{ type: 'toggleThemePicker' }])
      expect(actions(press(open({ themePickerFilter: 'nor' }), '', { escape: true }))).toEqual([{ type: 'clearThemePickerFilter' }])
    })

    it('applies the preset under the cursor on Enter, after closing', () => {
      const state = open({ themePickerIndex: 2 })
      const preset = getThemePickerSelection(state)
      expect(preset).toBeDefined()
      expect(actions(press(state, '', { return: true }))).toEqual([{ type: 'toggleThemePicker' }, { type: 'applyThemePreset', preset }])
    })

    it('applies the filtered preset, not the one at that index in the full list', () => {
      const state = open({ themePickerFilter: 'nord', themePickerIndex: 0 })
      const [, apply] = actions(press(state, '', { return: true })) as Array<{ preset?: string }>
      expect(apply.preset).toBe(filterThemePresets('nord')[0])
    })

    it('just closes on Enter when the filter matches nothing', () => {
      expect(actions(press(open({ themePickerFilter: 'zzzzzzzz-no-such-theme' }), '', { return: true }))).toEqual([{ type: 'toggleThemePicker' }])
    })

    it('moves with the arrows and Ctrl-P / Ctrl-N, carrying the filtered count', () => {
      const state = open({ themePickerFilter: 'dark' })
      const count = filterThemePresets('dark').length
      expect(actions(press(state, '', { upArrow: true }))).toEqual([{ type: 'moveThemePicker', delta: -1, presetCount: count }])
      expect(actions(press(state, 'n', { ctrl: true }))).toEqual([{ type: 'moveThemePicker', delta: 1, presetCount: count }])
      expect(actions(press(state, 'p', { ctrl: true }))).toEqual([{ type: 'moveThemePicker', delta: -1, presetCount: count }])
      expect(actions(press(state, '', { downArrow: true }))).toEqual([{ type: 'moveThemePicker', delta: 1, presetCount: count }])
    })

    it('edits the filter: backspace, delete, Ctrl-U', () => {
      expect(actions(press(open(), '', { backspace: true }))).toEqual([{ type: 'backspaceThemePickerFilter' }])
      expect(actions(press(open(), '', { delete: true }))).toEqual([{ type: 'backspaceThemePickerFilter' }])
      expect(actions(press(open(), 'u', { ctrl: true }))).toEqual([{ type: 'clearThemePickerFilter' }])
    })

    it('types printable keys into the filter, j and k included, and ignores chords', () => {
      expect(actions(press(open(), 'j'))).toEqual([{ type: 'appendThemePickerFilter', value: 'j' }])
      expect(actions(press(open(), 'k'))).toEqual([{ type: 'appendThemePickerFilter', value: 'k' }])
      expect(press(open(), 'x', { ctrl: true })).toEqual([])
      expect(press(open(), 'x', { meta: true })).toEqual([])
      expect(press(open(), '')).toEqual([])
    })
  })

  describe('gitignore picker', () => {
    const open = (over: Record<string, unknown> = {}) => stateWith({ gitignorePicker: { file: 'src/debug.log', index: 0 }, ...over })
    const optionsFor = (file: string) => deriveGitignoreOptions(file)

    it('closes on Esc', () => {
      expect(actions(press(open(), '', { escape: true }))).toEqual([{ type: 'closeGitignorePicker' }])
    })

    it('moves with the arrows and Ctrl-P / Ctrl-N, carrying the option count', () => {
      const count = optionsFor('src/debug.log').length
      expect(actions(press(open(), '', { downArrow: true }))).toEqual([{ type: 'moveGitignorePicker', delta: 1, count }])
      expect(actions(press(open(), 'p', { ctrl: true }))).toEqual([{ type: 'moveGitignorePicker', delta: -1, count }])
    })

    it('adds the chosen pattern on Enter, after closing', () => {
      const options = optionsFor('src/debug.log')
      const chosen = options.findIndex((option) => !option.custom && option.pattern !== 'src/debug.log')
      expect(chosen).toBeGreaterThanOrEqual(0)
      const state = open({ gitignorePicker: { file: 'src/debug.log', index: chosen } })
      expect(press(state, '', { return: true })).toEqual([
        { type: 'action', action: { type: 'closeGitignorePicker' } },
        { type: 'runWorkflowAction', id: 'add-to-gitignore', payload: options[chosen].pattern },
      ])
    })

    it('hands the custom option to a free-text prompt, seeded with its pattern', () => {
      const options = optionsFor('src/debug.log')
      const index = options.findIndex((option) => option.custom)
      expect(index).toBeGreaterThanOrEqual(0)
      const events = actions(press(open({ gitignorePicker: { file: 'src/debug.log', index } }), '', { return: true })) as Array<Record<string, unknown>>
      expect(events[0]).toEqual({ type: 'closeGitignorePicker' })
      expect(events[1]).toMatchObject({ type: 'openInputPrompt', kind: 'gitignore-pattern', initial: options[index].pattern })
    })

    it('clamps a cursor past the end to the last option', () => {
      const options = optionsFor('src/debug.log')
      const last = options[options.length - 1]
      const events = actions(press(open({ gitignorePicker: { file: 'src/debug.log', index: 99 } }), '', { return: true })) as Array<Record<string, unknown>>
      expect(events[0]).toEqual({ type: 'closeGitignorePicker' })
      // The last option is the custom one, which opens a prompt rather than adding.
      expect(last.custom ? events[1].type : events[1].id).toBe(last.custom ? 'openInputPrompt' : 'add-to-gitignore')
    })

    it('swallows every other key, so the status view behind does not see it', () => {
      for (const [input, key] of [['j', {}], ['s', {}], ['x', { ctrl: true }], ['', {}]] as Array<[string, Key]>) {
        expect(press(open(), input, key)).toEqual([])
      }
    })
  })

  describe('command palette', () => {
    const open = (over: Record<string, unknown> = {}) => stateWith({ showCommandPalette: true, activeView: 'history', paletteFilter: '', paletteSelectedIndex: 0, paletteRecent: [], ...over })
    const listFor = (state: LogInkState) => filterLogInkPaletteCommands(getLogInkPaletteCommands(state.activeView), state.paletteFilter, state.paletteRecent)

    it('closes on Esc, but clears a typed filter first', () => {
      expect(actions(press(open(), '', { escape: true }))).toEqual([{ type: 'toggleCommandPalette' }])
      expect(actions(press(open({ paletteFilter: 'stash' }), '', { escape: true }))).toEqual([{ type: 'clearPaletteFilter' }])
    })

    it('on Enter records the command as recent, closes, then runs it', () => {
      const state = open({ paletteFilter: 'refresh', paletteSelectedIndex: 0 })
      const selected = listFor(state)[0]
      const events = press(state, '', { return: true }) ?? []
      expect(events[0]).toEqual({ type: 'action', action: { type: 'recordPaletteRecent', value: selected.id } })
      expect(events[1]).toEqual({ type: 'action', action: { type: 'toggleCommandPalette' } })
      expect(events.slice(2)).toEqual(getLogInkPaletteExecuteEvents(selected, state, {}))
    })

    it('runs the filtered command at the cursor, not the one at that index in the full list', () => {
      const state = open({ paletteFilter: 'refresh' })
      const [recorded] = actions(press(state, '', { return: true })) as Array<{ value: string }>
      expect(recorded.value).toBe(listFor(state)[0].id)
      expect(recorded.value).not.toBe(getLogInkPaletteCommands('history')[0].id)
    })

    it('just closes on Enter when nothing matches', () => {
      expect(actions(press(open({ paletteFilter: 'zzzzzzzz-no-such-command' }), '', { return: true }))).toEqual([{ type: 'toggleCommandPalette' }])
    })

    it('moves with the arrows and Ctrl-P / Ctrl-N, carrying the filtered count', () => {
      const state = open({ paletteFilter: 'stash' })
      const commandCount = listFor(state).length
      expect(actions(press(state, '', { upArrow: true }))).toEqual([{ type: 'movePaletteSelection', delta: -1, commandCount }])
      expect(actions(press(state, 'n', { ctrl: true }))).toEqual([{ type: 'movePaletteSelection', delta: 1, commandCount }])
    })

    it('edits and types into the filter, and ignores chords', () => {
      expect(actions(press(open(), '', { backspace: true }))).toEqual([{ type: 'backspacePaletteFilter' }])
      expect(actions(press(open(), 'u', { ctrl: true }))).toEqual([{ type: 'clearPaletteFilter' }])
      expect(actions(press(open(), 'q'))).toEqual([{ type: 'appendPaletteFilter', value: 'q' }])
      expect(press(open(), 'x', { ctrl: true })).toEqual([])
      expect(press(open(), 'x', { meta: true })).toEqual([])
    })
  })

  describe('help overlay', () => {
    const open = (over: Record<string, unknown> = {}) => stateWith({ showHelp: true, helpFilterMode: false, helpFilter: '', ...over })

    it('closes on Esc and on ?, but clears a committed filter before closing on Esc', () => {
      expect(actions(press(open(), '', { escape: true }))).toEqual([{ type: 'toggleHelp' }])
      expect(actions(press(open(), '?'))).toEqual([{ type: 'toggleHelp' }])
      expect(actions(press(open({ helpFilter: 'stage' }), '', { escape: true }))).toEqual([{ type: 'clearHelpFilter' }])
      // `?` closes even with a filter: only Esc is two-stage.
      expect(actions(press(open({ helpFilter: 'stage' }), '?'))).toEqual([{ type: 'toggleHelp' }])
    })

    it('opens the type-to-filter input on /', () => {
      expect(actions(press(open(), '/'))).toEqual([{ type: 'openHelpFilter' }])
    })

    it('while the filter input is open: types, edits, commits on Enter, clears on Esc, and does not treat q or / as commands', () => {
      const filtering = open({ helpFilterMode: true })
      expect(actions(press(filtering, 'q'))).toEqual([{ type: 'appendHelpFilter', value: 'q' }])
      expect(actions(press(filtering, '/'))).toEqual([{ type: 'appendHelpFilter', value: '/' }])
      expect(actions(press(filtering, '', { backspace: true }))).toEqual([{ type: 'backspaceHelpFilter' }])
      expect(actions(press(filtering, '', { return: true }))).toEqual([{ type: 'commitHelpFilter' }])
      expect(actions(press(filtering, '', { escape: true }))).toEqual([{ type: 'clearHelpFilter' }])
      expect(press(filtering, 'x', { ctrl: true })).toEqual([])
    })

    it('scrolls with j/k, the arrows, and Ctrl-D / Ctrl-U', () => {
      expect(actions(press(open(), 'j'))).toEqual([{ type: 'scrollHelp', delta: 1 }])
      expect(actions(press(open(), '', { downArrow: true }))).toEqual([{ type: 'scrollHelp', delta: 1 }])
      expect(actions(press(open(), 'k'))).toEqual([{ type: 'scrollHelp', delta: -1 }])
      expect(actions(press(open(), 'd', { ctrl: true }))).toEqual([{ type: 'scrollHelp', delta: 10 }])
      expect(actions(press(open(), 'u', { ctrl: true }))).toEqual([{ type: 'scrollHelp', delta: -10 }])
    })

    it('quits on q through the quit guard', () => {
      const state = open()
      expect(press(state, 'q')).toEqual(resolveQuitEvents(state))
    })

    it('swallows everything else, so a stray key cannot change focus behind it', () => {
      for (const [input, key] of [['x', {}], ['g', {}], ['y', {}], ['s', {}], ['', { tab: true }]] as Array<[string, Key]>) {
        expect(press(open(), input, key)).toEqual([])
      }
    })
  })

  describe('view-keys strip', () => {
    const open = () => stateWith({ showViewKeys: true })

    it('closes on Esc and steps up to the full help on ?', () => {
      expect(actions(press(open(), '', { escape: true }))).toEqual([{ type: 'toggleViewKeys' }])
      expect(actions(press(open(), '?'))).toEqual([{ type: 'toggleHelp' }])
    })

    it('quits on q through the quit guard', () => {
      expect(press(open(), 'q')).toEqual(resolveQuitEvents(open()))
    })

    it('swallows every other key', () => {
      for (const input of ['j', 'k', 'y', 's', ' ']) expect(press(open(), input)).toEqual([])
    })
  })

  describe('precedence when more than one flag is set', () => {
    it('the theme picker wins over everything below it', () => {
      const state = stateWith({ showThemePicker: true, themePickerFilter: '', gitignorePicker: { file: 'a', index: 0 }, showCommandPalette: true, showHelp: true, showViewKeys: true })
      expect(actions(press(state, 'j'))).toEqual([{ type: 'appendThemePickerFilter', value: 'j' }])
    })

    it('then the gitignore picker, the palette, help, and the view-keys strip, in that order', () => {
      const palette = { showCommandPalette: true, paletteFilter: '', paletteSelectedIndex: 0, paletteRecent: [], activeView: 'history' as const }
      expect(press(stateWith({ gitignorePicker: { file: 'a', index: 0 }, ...palette, showHelp: true, showViewKeys: true }), 'j')).toEqual([])
      expect(actions(press(stateWith({ ...palette, showHelp: true, showViewKeys: true }), 'j'))).toEqual([{ type: 'appendPaletteFilter', value: 'j' }])
      expect(actions(press(stateWith({ showHelp: true, helpFilterMode: false, showViewKeys: true }), 'j'))).toEqual([{ type: 'scrollHelp', delta: 1 }])
      expect(press(stateWith({ showViewKeys: true }), 'j')).toEqual([])
    })
  })
})
