import {
    LOG_INK_KEY_BINDINGS,
    combineLogInkBreadcrumbSegments,
    filterLogInkPaletteCommands,
    formatBindingBareKeys,
    formatLogInkBreadcrumb,
    formatLogInkRepoBreadcrumb,
    getLogInkChordContinuations,
    getLogInkCommandPaletteItems,
    getLogInkFooterHints,
    getLogInkHelpSections,
    getLogInkPaletteCommands,
    getLogInkViewKeyBindings,
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
      contextual: ['↑/↓ move', 'enter diff', 'c/R/Z/i mutate', 'f fixup', 'B/gT new', 'm compare', 'y/Y yank', '/ search'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'status',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ files', 'enter hunks', 'space stage', 'A stage all', 'z revert', 'e/c compose'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'diff',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['j/k lines', '[/] hunk', 'v select', 'space stage', 'a stage file', 'z discard', 'o edit', 'esc back'],
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
      contextual: ['e edit', 'c commit', 'a amend', 'A stage all', '+ stage…', 'S split', 'I AI draft', 'esc back'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    // Split-plan overlay claims the footer while open — underlying
    // view's bindings are all intercepted, so surfacing them would
    // mislead the user about what works. Each phase gets its own
    // hint set since most keys no-op during loading / applying.
    expect(getLogInkFooterHints({
      activeView: 'compose',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
      splitPlanStatus: 'ready',
    })).toEqual({
      contextual: ['↑/↓ scroll', 'pg up/dn', 'g/G top/bot', 'y apply', 'r regen', 'esc cancel'],
      global: ['q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'compose',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
      splitPlanStatus: 'loading',
    })).toEqual({
      contextual: ['generating plan…', 'esc cancel'],
      global: ['q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'compose',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
      splitPlanStatus: 'applying',
    })).toEqual({
      contextual: ['applying split…'],
      global: [],
    })

    expect(getLogInkFooterHints({
      activeView: 'branches',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ branches', 'enter checkout', '+ new', 'x/v mark', 'D delete', 'r rebase', 'm compare', 's sort', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'tags',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ tags', '+ new', 'P push', 'T delete', 'm compare', 's sort', 'y yank'],
      global: ['g jump', '< back', '? help', ': cmds', 'q quit'],
    })

    expect(getLogInkFooterHints({
      activeView: 'stash',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })).toEqual({
      contextual: ['↑/↓ stashes', 'enter diff', 'a/A apply', 'p pop', 'R rename', 'b branch', 'X drop · u undo'],
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
      '↑/↓ branches', '←/→ tab', 'enter checkout',
      'F fetch', 'U pull', 'P push',
      'D delete', 'R rename', 'u upstream',
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
      // Honest help footer (#1355): every advertised key is live in
      // the help handler; / opens the overlay's type-to-filter.
      contextual: ['? close', '/ filter', 'j/k scroll'],
      global: ['q quit'],
    })

    expect(getLogInkFooterHints({
      filterMode: false,
      focus: 'commits',
      showHelp: true,
      helpFilterMode: true,
    })).toEqual({
      // While typing a help filter, `? close` / `/ filter` / `j/k scroll`
      // no longer apply — the input swallows them (#1431).
      contextual: ['enter keep', 'esc clear', 'type to filter'],
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

  it('groups help into the active view (leading, #1355) and Global', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })

    // "This view" leads: ? answers "what can I do HERE" first.
    expect(sections.map((section) => section.title)).toEqual([
      'This view (history)',
      'Global',
    ])

    const globals = sections[1].bindings.map((binding) => binding.id)
    expect(globals).toContain('help')
    expect(globals).toContain('commandPalette')
    expect(globals).toContain('quit')
    expect(globals).toContain('focusNext')
    expect(globals).not.toContain('moveUp')

    const viewBindings = sections[0].bindings.map((binding) => binding.id)
    expect(viewBindings).toContain('moveUp')
    expect(viewBindings).toContain('search')
    expect(viewBindings).toContain('toggleGraph')
    expect(viewBindings).not.toContain('quit')
    expect(viewBindings).not.toContain('help')
  })

  it('renders the help label with the active view', () => {
    const status = getLogInkHelpSections({ activeView: 'status', focus: 'commits' })
    expect(status[0].title).toBe('This view (status)')

    const diff = getLogInkHelpSections({ activeView: 'diff', focus: 'detail' })
    expect(diff[0].title).toBe('This view (diff)')
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
    expect(helpText).toContain('z Ask to revert the selected file or hunk, or undo the last operation.')
    expect(helpText).toContain('e Edit the manual commit summary or body inline.')
    expect(helpText).toContain('E Open the current commit draft in $EDITOR (or $VISUAL) for full editing, write-back on save.')
    // On history view, `c` is cherry-pick (the `c commit` binding is
    // scoped to status/diff/compose where it actually fires).
    expect(helpText).toContain('c Cherry-pick the cursored commit onto the current branch.')
    expect(helpText).toContain('B Create a branch at the cursored commit (does not switch).')
    expect(helpText).toContain('q/ctrl+c Quit the interactive log.')
    expect(helpText).toContain('tab Move focus to the next panel.')
  })

  it('formats the navigation breadcrumb as pure location (no back-hint)', () => {
    expect(formatLogInkBreadcrumb([])).toBe('')
    expect(formatLogInkBreadcrumb(['history'])).toBe('')
    expect(formatLogInkBreadcrumb(['status'])).toBe('status')
    expect(formatLogInkBreadcrumb(['history', 'diff'])).toBe('history › diff')
    expect(formatLogInkBreadcrumb(['history', 'status', 'diff']))
      .toBe('history › status › diff')
    expect(formatLogInkBreadcrumb(['history', 'compose'])).toBe('history › compose')
  })

  describe('formatLogInkRepoBreadcrumb (#931)', () => {
    it('returns empty for an empty stack', () => {
      expect(formatLogInkRepoBreadcrumb([])).toBe('')
    })

    it('returns empty for a single-frame (root-only) stack', () => {
      expect(formatLogInkRepoBreadcrumb([{ label: 'root' }])).toBe('')
      expect(formatLogInkRepoBreadcrumb([{ label: 'coco' }])).toBe('')
    })

    it('renders a two-frame stack with the back-hint cue', () => {
      expect(formatLogInkRepoBreadcrumb([
        { label: 'coco' },
        { label: 'vendor/lib' },
      ])).toBe('coco › vendor/lib   ← esc')
    })

    it('renders a deeper stack with frames joined by the same separator', () => {
      expect(formatLogInkRepoBreadcrumb([
        { label: 'coco' },
        { label: 'vendor/lib' },
        { label: 'vendor/lib/inner' },
      ])).toBe('coco › vendor/lib › vendor/lib/inner   ← esc')
    })

    it('reads only the label off each frame and ignores other fields', () => {
      // Frames will carry `parentReturn`, `entryRange`, `workdir`, etc.
      // The formatter must not surface any of that in the chrome line.
      expect(formatLogInkRepoBreadcrumb([
        { label: 'coco', workdir: '/abs/coco' } as { label: string },
        { label: 'vendor/lib', workdir: '/abs/coco/vendor/lib' } as { label: string },
      ])).toBe('coco › vendor/lib   ← esc')
    })
  })

  describe('combineLogInkBreadcrumbSegments (#931)', () => {
    it('returns empty when both segments are empty', () => {
      expect(combineLogInkBreadcrumbSegments('', '')).toBe('')
    })

    it('renders only the repo crumb when the view crumb is empty', () => {
      expect(combineLogInkBreadcrumbSegments('coco › vendor/lib   ← esc', ''))
        .toBe('  coco › vendor/lib   ← esc')
    })

    it('renders only the view crumb when the repo crumb is empty', () => {
      expect(combineLogInkBreadcrumbSegments('', 'history › diff'))
        .toBe('  history › diff')
    })

    it('joins repo + view with extra spacing when both are present', () => {
      expect(combineLogInkBreadcrumbSegments(
        'coco › vendor/lib   ← esc',
        'history › diff',
      )).toBe('  coco › vendor/lib   ← esc    history › diff')
    })

    it('matches the leading-spaces convention the existing view-only path used', () => {
      // Before #931 the chrome did `  ${breadcrumb}` when only the view
      // stack was nested. This contract assertion locks in the legacy
      // behavior so the visible header doesn't shift for non-nested
      // sessions.
      const viewOnly = combineLogInkBreadcrumbSegments('', 'status')
      expect(viewOnly).toBe('  status')
    })
  })

  it('exposes the gc compose chord as a global navigation binding', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })
    const globalIds = sections[1].bindings.map((binding) => binding.id)

    expect(globalIds).toContain('navigateCompose')

    const composeBinding = sections[1].bindings.find((binding) => binding.id === 'navigateCompose')
    expect(composeBinding?.keys).toEqual(['gc'])
  })

  it('exposes the gb/gt/gz chords as global navigation bindings', () => {
    const sections = getLogInkHelpSections({ activeView: 'history', focus: 'commits' })
    const globals = sections[1].bindings

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

    // Regression: the scattered-letter fallback used to run across every
    // searchable field — long descriptions matched almost any short
    // query ("changel" pulled in yank, submodules, stash, and "Request
    // changes"), burying the real hit in noise. Scattered-letter matches
    // are label-only now; exact/prefix/substring still search all fields.
    it('does not scatter-match query letters across command descriptions', () => {
      const commands = getLogInkPaletteCommands()
      const results = filterLogInkPaletteCommands(commands, 'changel', [])

      expect(results.length).toBeGreaterThan(0)
      for (const command of results) {
        const label = command.label.toLowerCase()
        const haystacks = [command.label, command.description, command.keys, command.id]
          .map((field) => field.toLowerCase())
        const substringHit = haystacks.some((field) => field.includes('changel'))
        // Anything surviving without a real substring hit must at least
        // scatter-match within its LABEL, not its description.
        if (!substringHit) {
          let cursor = 0
          const scatterInLabel = [...'changel'].every((ch) => {
            const at = label.indexOf(ch, cursor)
            if (at < 0) return false
            cursor = at + 1
            return true
          })
          expect(scatterInLabel).toBe(true)
        }
      }
      expect(results.map((command) => command.id)).not.toContain('yank')
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
    expect(palette.find((item) => item.id === 'workflowDeleteBranch')).toMatchObject({
      label: 'delete branch',
    })
    expect(palette.find((item) => item.id === 'workflowAiCommitSummary')).toMatchObject({
      label: 'AI commit summary',
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
      // Intent-based labels: rebase swaps git's ours/theirs sides, so
      // the hints name what the user keeps, not the git flag.
      expect(hints.contextual).toContain('u incoming')
      expect(hints.contextual).toContain('U yours')
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

  describe('view-keys which-key strip (g?, #1137)', () => {
    it('registers viewKeys on the g? chord', () => {
      const binding = LOG_INK_KEY_BINDINGS.find((b) => b.id === 'viewKeys')
      expect(binding).toBeDefined()
      expect(binding!.keys).toEqual(['g?'])
    })

    it('surfaces in the g-chord which-key continuations', () => {
      const continuations = getLogInkChordContinuations('g')
      expect(continuations.some((c) => c.key === '?' && c.label === 'keys')).toBe(true)
    })

    it('is reachable from the command palette', () => {
      const ids = getLogInkPaletteCommands().map((command) => command.id)
      expect(ids).toContain('viewKeys')
    })

    it('lists single-key view actions sourced from the binding table', () => {
      const bindings = getLogInkViewKeyBindings({ activeView: 'history', focus: 'commits' })
      const ids = bindings.map((b) => b.id)
      // History overloads the issue calls out: cherry-pick (c), revert (R), etc.
      expect(ids).toContain('viewCherryPick')
      expect(ids).toContain('revertSelection')
      // Every entry exposes at least one bare single key.
      expect(bindings.every((b) => b.keys.some((k) => k.length === 1))).toBe(true)
    })

    it('excludes chord-only and global bindings', () => {
      const bindings = getLogInkViewKeyBindings({ activeView: 'history', focus: 'commits' })
      const ids = bindings.map((b) => b.id)
      // Globals (help/quit) and chord-only nav (gh/gs/…) are not single-key
      // per-view actions and stay out of the strip.
      expect(ids).not.toContain('help')
      expect(ids).not.toContain('quit')
      expect(ids).not.toContain('navigateHome')
      expect(ids).not.toContain('viewKeys')
    })

    it('changes with the active view context', () => {
      const branches = getLogInkViewKeyBindings({ activeView: 'branches', focus: 'commits' })
        .map((b) => b.id)
      // markForCompare (m) is a branches/tags/history action.
      expect(branches).toContain('markForCompare')
      // Sidebar-only tab cycling shouldn't appear when focus is on commits.
      const sidebar = getLogInkViewKeyBindings({ activeView: 'history', focus: 'sidebar' })
        .map((b) => b.id)
      expect(sidebar).toContain('nextSidebarTab')
    })

    it('sorts entries by their first bare key', () => {
      const bindings = getLogInkViewKeyBindings({ activeView: 'history', focus: 'commits' })
      const keys = bindings.map((b) => formatBindingBareKeys(b).charAt(0))
      expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
    })
  })

  describe('formatBindingBareKeys', () => {
    it('keeps only bare single keys, dropping named and chord keys', () => {
      const moveUp = LOG_INK_KEY_BINDINGS.find((b) => b.id === 'moveUp')!
      // keys: ['up', 'k'] → only 'k' is bare.
      expect(formatBindingBareKeys(moveUp)).toBe('k')
    })

    it('joins multiple bare keys with a slash', () => {
      const binding = { id: 'x', keys: ['a', 'A'], label: '', description: '', contexts: [] } as never
      expect(formatBindingBareKeys(binding)).toBe('a / A')
    })
  })

  describe('theme picker binding (gC)', () => {
    it('registers themePicker on the gC chord', () => {
      const binding = LOG_INK_KEY_BINDINGS.find((b) => b.id === 'themePicker')
      expect(binding).toBeDefined()
      expect(binding!.keys).toContain('gC')
    })

    it('surfaces in the g-chord which-key continuations', () => {
      const continuations = getLogInkChordContinuations('g')
      expect(continuations.some((c) => c.key === 'C' && c.label === 'theme picker')).toBe(true)
    })

    it('is reachable from the command palette', () => {
      const ids = getLogInkPaletteCommands().map((command) => command.id)
      expect(ids).toContain('themePicker')
    })

    it('does not collide with any other binding', () => {
      const withGc = LOG_INK_KEY_BINDINGS.filter((b) => b.keys.includes('gC'))
      expect(withGc).toHaveLength(1)
      expect(withGc[0].id).toBe('themePicker')
    })
  })
})

describe('PR triage review flow hints (#1363)', () => {
  it('surfaces the enter-diff + C-checkout pair on the triage list footer', () => {
    const hints = getLogInkFooterHints({
      activeView: 'pull-request-triage',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })
    expect(hints.contextual).toContain('enter diff')
    expect(hints.contextual).toContain('C checkout')
  })

  it('gives the PR-sourced diff its own read-only hint set (file jump + checkout, no mutate verbs)', () => {
    const hints = getLogInkFooterHints({
      activeView: 'diff',
      diffSource: 'pr',
      filterMode: false,
      focus: 'commits',
      showHelp: false,
    })
    expect(hints.contextual).toEqual(['j/k lines', '[/] file', 'C checkout', 'd split', 'esc back'])
    // The stash/commit-diff mutate verbs must not leak in — the PR's
    // files aren't in the local worktree.
    expect(hints.contextual).not.toContain('c cherry-pick')
    expect(hints.contextual).not.toContain('H apply hunk')
    expect(hints.contextual).not.toContain('o edit')
  })
})
