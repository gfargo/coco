import {
  LOG_INK_KEY_BINDINGS,
  filterLogInkPaletteCommands,
  formatLogInkBreadcrumb,
  getLogInkChordContinuations,
  getLogInkCommandPaletteItems,
  getLogInkFooterHints,
  getLogInkHelpSections,
  getLogInkPaletteCommands,
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
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'status',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'enter diff', 'space stage', 'z revert', 'e/c compose'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'diff',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['j/k hunks', 'space stage', 'z revert', 'e/c compose', 'esc files'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'compose',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['e edit', 'tab field', 'c commit', 'I AI draft', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'branches',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ branches', 'D delete', 'X checkout', 'enter diff', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'tags',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ tags', 'T create', 'X push', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'stash',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ stashes', 'A apply', 'D drop', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
    })).toEqual({
      contextual: ['[/] tab', '1-5 jump', 'tab focus'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'detail',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'pgup/pgdn diff', 'tab focus'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
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
    expect(helpText).toContain('\\ Toggle compact and full graph display.')
    expect(helpText).toContain('gg Jump to the first visible commit.')
    expect(helpText).toContain('G Jump to the last visible commit.')
    expect(helpText).toContain('z Ask to revert the selected file or hunk.')
    expect(helpText).toContain('e Edit the manual commit summary or body.')
    expect(helpText).toContain('c Create a commit from staged changes with the current draft.')
    expect(helpText).toContain('q/ctrl+c Quit the interactive log.')
    expect(helpText).toContain('tab Move focus to the next panel.')
  })

  it('formats the navigation breadcrumb with a back-hint cue when nested', () => {
    expect(formatLogInkBreadcrumb([])).toBe('')
    expect(formatLogInkBreadcrumb(['history'])).toBe('')
    expect(formatLogInkBreadcrumb(['status'])).toBe('status   ← <')
    expect(formatLogInkBreadcrumb(['history', 'diff'])).toBe('history › diff   ← <')
    expect(formatLogInkBreadcrumb(['history', 'status', 'diff']))
      .toBe('history › status › diff   ← <')
    expect(formatLogInkBreadcrumb(['history', 'compose'])).toBe('history › compose   ← <')
  })

  it('exposes the gc compose chord as a global navigation binding', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })
    const globalIds = sections[0].bindings.map((binding) => binding.id)

    expect(globalIds).toContain('navigateCompose')

    const composeBinding = sections[0].bindings.find((binding) => binding.id === 'navigateCompose')
    expect(composeBinding?.keys).toEqual(['gc'])
  })

  it('exposes the gb/gt/gz chords as global navigation bindings', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })
    const globals = sections[0].bindings

    const branches = globals.find((binding) => binding.id === 'navigateBranches')
    const tags = globals.find((binding) => binding.id === 'navigateTags')
    const stash = globals.find((binding) => binding.id === 'navigateStash')

    expect(branches?.keys).toEqual(['gb'])
    expect(tags?.keys).toEqual(['gt'])
    expect(stash?.keys).toEqual(['gz'])
  })

  describe('palette commands', () => {
    it('returns both keybinding-derived and workflow commands', () => {
      const commands = getLogInkPaletteCommands()
      const ids = commands.map((command) => command.id)
      const kinds = new Set(commands.map((command) => command.kind))

      expect(ids).toContain('navigateHome')
      expect(ids).toContain('toggleGraph')
      expect(ids).toContain('delete-branch')
      expect(ids).toContain('ai-commit-summary')
      expect(kinds).toEqual(new Set(['binding', 'workflow']))
    })

    it('passes through every command when filter is empty and no recent', () => {
      const commands = getLogInkPaletteCommands()
      const result = filterLogInkPaletteCommands(commands, '', [])
      expect(result.length).toBe(commands.length)
    })

    it('floats recent commands to the top when the filter is empty', () => {
      const commands = getLogInkPaletteCommands()
      const result = filterLogInkPaletteCommands(commands, '', ['toggleGraph', 'navigateStash'])

      expect(result[0].id).toBe('toggleGraph')
      expect(result[1].id).toBe('navigateStash')
      expect(result.length).toBe(commands.length)
    })

    it('fuzzy-matches the filter against label, description, keys, and id', () => {
      const commands = getLogInkPaletteCommands()

      expect(filterLogInkPaletteCommands(commands, 'home', [])[0].id).toBe('navigateHome')

      const diffResults = filterLogInkPaletteCommands(commands, 'gd', [])
      expect(diffResults.map((command) => command.id)).toContain('navigateDiff')

      expect(filterLogInkPaletteCommands(commands, 'compose', [])[0].id).toBe('navigateCompose')
    })

    it('drops commands that do not match the filter at all', () => {
      const commands = getLogInkPaletteCommands()
      const result = filterLogInkPaletteCommands(commands, 'zzzzznosuchcommand', [])
      expect(result).toHaveLength(0)
    })

    it('ignores recent ordering when a filter is set (relevance wins)', () => {
      const commands = getLogInkPaletteCommands()
      const result = filterLogInkPaletteCommands(commands, 'compose', ['navigateStash'])
      expect(result[0].id).toBe('navigateCompose')
    })
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

  describe('chord continuations', () => {
    it('returns the registered second-key continuations for the g chord prefix', () => {
      const continuations = getLogInkChordContinuations('g')
      const keys = continuations.map((entry) => entry.key)
      expect(keys).toEqual(expect.arrayContaining(['h', 's', 'd', 'c', 'b', 't', 'z', 'g']))
      // Sorted alphabetically for stable rendering.
      expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
    })

    it('returns an empty list for unknown prefixes', () => {
      expect(getLogInkChordContinuations('z')).toEqual([])
    })
  })

  describe('footer chord hints', () => {
    it('replaces the contextual slot with chord continuations when pendingKey is set', () => {
      const hints = getLogInkFooterHints({
        activeView: 'history',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
        pendingKey: 'g',
      })
      expect(hints.contextual[0]).toBe('g …')
      expect(hints.contextual.some((entry) => entry.startsWith('h '))).toBe(true)
      expect(hints.global).toContain('esc cancel')
    })

    it('falls through to normal hints when pendingKey is unset', () => {
      const hints = getLogInkFooterHints({
        activeView: 'history',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual[0]).not.toBe('g …')
    })
  })
})
