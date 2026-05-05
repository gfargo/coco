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
      // `c/R/Z/i mutate` is the compact chip for cherry-pick / revert /
      // reset / interactive-rebase — full descriptions in ? help and
      // the palette. `B/gT new` covers create-branch-here / create-tag-here.
      contextual: ['↑/↓ move', 'enter diff', 'c/R/Z/i mutate', 'B/gT new', 'y/Y yank', '/ search', 'gg/G top/bottom'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'status',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'enter diff', 'space stage', 'z revert', 'e/c compose', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'diff',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['j/k hunks', 'space stage', 'z revert', 'o edit', 'e/c compose', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    // Hunk-apply (#782): commit-diff and stash-diff hints surface `H`.
    expect(getLogInkFooterHints({
      activeView: 'diff',
      diffSource: 'commit',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    }).contextual).toContain('H apply hunk')

    expect(getLogInkFooterHints({
      activeView: 'diff',
      diffSource: 'stash',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    }).contextual).toContain('H apply hunk')

    expect(getLogInkFooterHints({
      activeView: 'compose',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['e edit', 'c commit', 'I AI draft', 'gs hunks', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'branches',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ branches', 'enter checkout', '+ new', 'D delete', 's sort', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'tags',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ tags', '+ new', 'P push', 'T delete', 's sort', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'stash',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ stashes', 'enter diff', 'a apply', 'p pop', 'X drop', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
    })).toEqual({
      // Sidebar focused with no per-tab context (no items / status tab):
      // generic "drill into the dedicated view" hint. ←/→ now switches
      // tabs (in-sidebar selection PR — vertical axis is items).
      contextual: ['←/→ tab', '1-5 jump', 'enter open', 'tab focus'],
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

  describe('diff view split/unified hint (#785)', () => {
    it('surfaces "d split" on a unified commit diff', () => {
      const hints = getLogInkFooterHints({
        activeView: 'diff',
        diffSource: 'commit',
        diffViewMode: 'unified',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual).toContain('d split')
    })

    it('surfaces "d unified" once split is active on a commit diff', () => {
      const hints = getLogInkFooterHints({
        activeView: 'diff',
        diffSource: 'commit',
        diffViewMode: 'split',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual).toContain('d unified')
    })

    it('surfaces the toggle on the stash diff source as well', () => {
      const hints = getLogInkFooterHints({
        activeView: 'diff',
        diffSource: 'stash',
        diffViewMode: 'unified',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual).toContain('d split')
    })

    it('does not surface the toggle on the worktree diff source', () => {
      // Worktree diff stays unified-only for now — staging is the
      // primary action there and split mode complicates the hunk picker.
      const hints = getLogInkFooterHints({
        activeView: 'diff',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual.some((h) => h.startsWith('d '))).toBe(false)
    })
  })

  // #791 follow-up — in-sidebar selection. When sidebar is focused on a
  // content tab WITH items, the footer surfaces the per-entity ops
  // (checkout / apply / pop / drop / etc.) so the user discovers that
  // they can act on the cursored item without drilling into the
  // dedicated view. Empty content tabs and the status tab fall back to
  // the generic "enter open" hint.
  it('surfaces per-tab in-sidebar ops when the focused tab has items', () => {
    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'branches',
      sidebarItemCount: 5,
    }).contextual).toEqual([
      '↑/↓ branches', '←/→ tab', 'enter checkout', 'D delete', 'R rename', 'u upstream',
    ])

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'stashes',
      sidebarItemCount: 3,
    }).contextual).toEqual([
      '↑/↓ stashes', '←/→ tab', 'enter diff', 'a apply', 'p pop', 'X drop',
    ])

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'tags',
      sidebarItemCount: 2,
    }).contextual).toEqual([
      '↑/↓ tags', '←/→ tab', '+ new', 'P push', 'T delete',
    ])

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'worktrees',
      sidebarItemCount: 1,
    }).contextual).toEqual([
      '↑/↓ worktrees', '←/→ tab', 'W remove',
    ])
  })

  it('falls back to the generic open hint when the sidebar tab has no items', () => {
    // Empty content tab (no branches, etc.) — surface the drill-in
    // affordance instead of per-item ops the user can't reach.
    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'branches',
      sidebarItemCount: 0,
    }).contextual).toEqual(['←/→ tab', '1-5 jump', 'enter open', 'tab focus'])

    // Status tab is excluded from the in-sidebar selection model — its
    // preview is worktree files which the dedicated status view owns.
    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'sidebar',
      showHelp: false,
      sidebarTab: 'status',
      sidebarItemCount: 12,
    }).contextual).toEqual(['←/→ tab', '1-5 jump', 'enter open', 'tab focus'])
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

  describe('conflicts view', () => {
    it('returns conflicts-specific footer hints', () => {
      const hints = getLogInkFooterHints({
        activeView: 'conflicts',
        filterMode: false,
        focus: 'commits',
        showHelp: false,
      })
      expect(hints.contextual).toContain('s stage')
      expect(hints.contextual).toContain('u theirs')
      expect(hints.contextual).toContain('U ours')
      expect(hints.contextual).toContain('o edit')
      expect(hints.contextual).toContain('C continue*')
      expect(hints.contextual).toContain('enter diff')
      expect(hints.global).toEqual(['g jump', '< back', '? help', ': cmds', 'q quit'])
    })

    it('includes gx in chord continuations for the g prefix', () => {
      const continuations = getLogInkChordContinuations('g')
      const conflictsEntry = continuations.find((entry) => entry.key === 'x')
      expect(conflictsEntry).toBeDefined()
      expect(conflictsEntry!.label).toBe('conflicts')
    })

    it('includes navigateConflicts in the key bindings registry', () => {
      const binding = LOG_INK_KEY_BINDINGS.find((b) => b.id === 'navigateConflicts')
      expect(binding).toBeDefined()
      expect(binding!.keys).toContain('gx')
    })
  })
})
