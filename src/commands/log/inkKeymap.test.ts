import { getLogInkFooterHints, getLogInkHelpSections } from './inkKeymap'

describe('log Ink keymap', () => {
  it('keeps footer hints short and contextual', () => {
    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual(['↑/↓ move', '/ search', 'tab focus', 'g graph', '? help'])

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
    })).toEqual([': close', 'r refresh', 'g graph', '? help', 'q quit'])
  })

  it('derives help from the same binding source', () => {
    const helpText = getLogInkHelpSections()
      .flatMap((section) => section.bindings)
      .map((binding) => `${binding.keys.join('/')} ${binding.description}`)
      .join('\n')

    expect(helpText).toContain('/ Filter commits')
    expect(helpText).toContain('g Toggle compact and full graph display.')
    expect(helpText).toContain('q/ctrl+c Quit the interactive log.')
    expect(helpText).toContain('tab Move focus to the next panel.')
  })
})
