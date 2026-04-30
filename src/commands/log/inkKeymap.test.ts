import {
  LOG_INK_KEY_BINDINGS,
  getLogInkCommandPaletteItems,
  getLogInkFooterHints,
  getLogInkHelpSections,
} from './inkKeymap'

describe('log Ink keymap', () => {
  it('keeps footer hints short and contextual', () => {
    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual(['↑/↓ move', '/ search', 'gg/G top/bottom', 'n/N next', '? help'])

    expect(getLogInkFooterHints({
      filterMode: true,
      focus: 'commits',
      showHelp: false,
    })).toEqual(['enter apply', 'esc cancel', 'ctrl+u clear', 'q quit'])

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showCommandPalette: true,
      showHelp: false,
    })).toEqual([': close', 'D/T/X confirm', 'I/M AI', '? help', 'q quit'])
  })

  it('derives help from the same binding source', () => {
    const helpText = getLogInkHelpSections()
      .flatMap((section) => section.bindings)
      .map((binding) => `${binding.keys.join('/')} ${binding.description}`)
      .join('\n')

    expect(helpText).toContain('/ Filter commits')
    expect(helpText).toContain('g Toggle compact and full graph display.')
    expect(helpText).toContain('gg Jump to the first visible commit.')
    expect(helpText).toContain('G Jump to the last visible commit.')
    expect(helpText).toContain('[ Move to the previous repository sidebar tab.')
    expect(helpText).toContain('q/ctrl+c Quit the interactive log.')
    expect(helpText).toContain('tab Move focus to the next panel.')
  })

  it('derives command palette entries from the shared keymap', () => {
    const palette = getLogInkCommandPaletteItems()

    expect(palette.map((item) => item.id)).toEqual(LOG_INK_KEY_BINDINGS.map((binding) => binding.id))
    expect(palette.find((item) => item.id === 'commandPalette')).toMatchObject({
      keys: ':',
      label: 'commands',
    })
    expect(palette.find((item) => item.id === 'workflowActions')).toMatchObject({
      label: 'workflows',
    })
  })
})
