import {
  LOG_INK_KEY_BINDINGS,
  formatLogInkBreadcrumb,
  getLogInkCommandPaletteItems,
  getLogInkFooterHints,
  getLogInkHelpSections,
} from './inkKeymap'

describe('log Ink keymap', () => {
  it('returns view-aware contextual hints alongside persistent globals', () => {
    expect(getLogInkFooterHints({
      activeView: 'history',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ move', '/ search', 'gg/G top/bottom', 'n/N next'],
      global: ['? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'status',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'enter diff', 'space stage', 'z revert', 'e/c compose'],
      global: ['? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'diff',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['j/k hunks', 'space stage', 'z revert', 'e/c compose', 'esc files'],
      global: ['? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
    })).toEqual({
      contextual: ['[/] tab', '1-5 jump', 'tab focus'],
      global: ['? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'detail',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'pgup/pgdn diff', 'tab focus'],
      global: ['? help', ': cmds', 'q quit'],
    })
  })

  it('reduces global hints in special modes (filter, help, palette)', () => {
    expect(getLogInkFooterHints({
      filterMode: true,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['enter apply', 'esc cancel', 'ctrl+u clear'],
      global: ['q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showHelp: true,
    })).toEqual({
      contextual: ['? close', 'tab focus', '/ search'],
      global: ['q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showCommandPalette: true,
      showHelp: false,
    })).toEqual({
      contextual: [': close', 'D/T/X confirm', 'I/M AI'],
      global: ['? help', 'q quit'],
    })
  })

  it('groups help into Global and the active view', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })

    expect(sections.map((section) => section.title)).toEqual([
      'Global',
      'This view (history)',
    ])

    const globals = sections[0].bindings.map((binding) => binding.id)
    expect(globals).toContain('help')
    expect(globals).toContain('commandPalette')
    expect(globals).toContain('quit')
    expect(globals).toContain('focusNext')
    expect(globals).not.toContain('moveUp')

    const viewBindings = sections[1].bindings.map((binding) => binding.id)
    expect(viewBindings).toContain('moveUp')
    expect(viewBindings).toContain('search')
    expect(viewBindings).toContain('toggleGraph')
    expect(viewBindings).not.toContain('quit')
    expect(viewBindings).not.toContain('help')
  })

  it('renders the help label with the active view', () => {
    const status = getLogInkHelpSections({ activeView: 'status', focus: 'commits' })
    expect(status[1].title).toBe('This view (status)')

    const diff = getLogInkHelpSections({ activeView: 'diff', focus: 'detail' })
    expect(diff[1].title).toBe('This view (diff)')
  })

  it('still derives bindings from the shared keymap', () => {
    const helpText = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })
      .flatMap((section) => section.bindings)
      .map((binding) => `${binding.keys.join('/')} ${binding.description}`)
      .join('\n')

    expect(helpText).toContain('/ Filter commits')
    expect(helpText).toContain('g Toggle compact and full graph display.')
    expect(helpText).toContain('gg Jump to the first visible commit.')
    expect(helpText).toContain('G Jump to the last visible commit.')
    expect(helpText).toContain('z Ask to revert the selected file or hunk.')
    expect(helpText).toContain('e Edit the manual commit summary or body.')
    expect(helpText).toContain('c Create a commit from staged changes with the current draft.')
    expect(helpText).toContain('q/ctrl+c Quit the interactive log.')
    expect(helpText).toContain('tab Move focus to the next panel.')
  })

  it('formats the navigation breadcrumb based on the view stack', () => {
    expect(formatLogInkBreadcrumb([])).toBe('')
    expect(formatLogInkBreadcrumb(['history'])).toBe('')
    expect(formatLogInkBreadcrumb(['status'])).toBe('status')
    expect(formatLogInkBreadcrumb(['history', 'diff'])).toBe('history › diff')
    expect(formatLogInkBreadcrumb(['history', 'status', 'diff'])).toBe('history › status › diff')
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
