import { createLogInkTheme } from './theme'

describe('log Ink theme', () => {
  it('creates semantic color tokens for normal terminals', () => {
    const theme = createLogInkTheme({ noColor: false, term: 'xterm-256color' })

    expect(theme.borderStyle).toBe('round')
    expect(theme.colors.accent).toBe('cyan')
    expect(theme.colors.warning).toBe('yellow')
    expect(theme.colors.danger).toBe('red')
  })

  it('respects monochrome and ASCII terminal settings', () => {
    const theme = createLogInkTheme({ noColor: true, term: 'dumb' })

    expect(theme.noColor).toBe(true)
    expect(theme.ascii).toBe(true)
    expect(theme.borderStyle).toBe('classic')
    expect(theme.colors).toEqual({})
  })

  it('supports configurable presets and token overrides', () => {
    const theme = createLogInkTheme({
      borderStyle: 'single',
      colors: {
        accent: '#ffffff',
      },
      env: { COLORTERM: 'truecolor' },
      noColor: false,
      preset: 'catppuccin',
      term: 'xterm-256color',
    })

    expect(theme.borderStyle).toBe('single')
    expect(theme.colors.focusBorder).toBe('#89dceb')
    expect(theme.colors.accent).toBe('#ffffff')
  })

  it('treats the monochrome preset as a no-color theme', () => {
    const theme = createLogInkTheme({ noColor: false, preset: 'monochrome' })

    expect(theme.noColor).toBe(true)
    expect(theme.colors).toEqual({})
  })

  describe('truecolor fallback (P5.2)', () => {
    it('downgrades catppuccin to default ANSI colors on a 16-color terminal', () => {
      const theme = createLogInkTheme({
        env: { TERM: 'xterm' },
        preset: 'catppuccin',
      })
      // Hex tokens (#89b4fa etc.) fall back to ANSI named colors.
      expect(theme.colors.accent).toBe('cyan')
      expect(theme.colors.danger).toBe('red')
    })

    it('downgrades gruvbox the same way', () => {
      const theme = createLogInkTheme({
        env: { TERM: 'xterm' },
        preset: 'gruvbox',
      })
      expect(theme.colors.accent).toBe('cyan')
    })

    it('keeps the hex preset when the terminal advertises truecolor', () => {
      const theme = createLogInkTheme({
        env: { COLORTERM: 'truecolor' },
        preset: 'catppuccin',
      })
      expect(theme.colors.accent).toBe('#89b4fa')
    })

    it('leaves the default preset alone regardless of color level', () => {
      const lowColor = createLogInkTheme({ env: { TERM: 'xterm' }, preset: 'default' })
      const highColor = createLogInkTheme({ env: { COLORTERM: 'truecolor' }, preset: 'default' })
      expect(lowColor.colors.accent).toBe('cyan')
      expect(highColor.colors.accent).toBe('cyan')
    })

    it('preserves a light preset selection through the downgrade (no dark bar on light themes)', () => {
      // Regression: on a non-truecolor terminal a light theme used to inherit
      // the default preset's dark selection (#1a3a4a), rendering the selected
      // row as a dark bar on a light background. The downgrade must keep the
      // requested theme's own (light) selection.
      const downgraded = createLogInkTheme({ env: { TERM: 'xterm-256color' }, preset: 'one-light' })
      expect(downgraded.colors.accent).toBe('cyan') // syntax still downgrades…
      expect(downgraded.colors.selection).toBe('#e5e5e6') // …but the selection stays light
      const truecolor = createLogInkTheme({ env: { COLORTERM: 'truecolor' }, preset: 'one-light' })
      expect(truecolor.colors.selection).toBe('#e5e5e6')
    })

    it('preserves a dark preset selection through the downgrade too', () => {
      const downgraded = createLogInkTheme({ env: { TERM: 'xterm' }, preset: 'catppuccin' })
      expect(downgraded.colors.selection).toBe('#45475a')
    })
  })

  describe('selection foreground', () => {
    it('derives a white foreground for dark-selection themes', () => {
      const theme = createLogInkTheme({
        env: { COLORTERM: 'truecolor' },
        preset: 'catppuccin',
      })
      expect(theme.colors.selection).toBe('#45475a')
      expect(theme.colors.selectionForeground).toBe('#ffffff')
    })

    it('derives a black foreground for light-selection themes', () => {
      const theme = createLogInkTheme({
        env: { COLORTERM: 'truecolor' },
        preset: 'solarized-light',
      })
      expect(theme.colors.selection).toBe('#eee8d5')
      expect(theme.colors.selectionForeground).toBe('#000000')
    })

    it('keeps a readable selection foreground through the non-truecolor downgrade', () => {
      // A light theme on a 16-color terminal downgrades its palette to
      // `default` but preserves its own light selection bg — the derived
      // foreground must follow the *preserved* bg, not default's dark one.
      const theme = createLogInkTheme({
        env: { TERM: 'xterm' },
        preset: 'solarized-light',
      })
      expect(theme.colors.selection).toBe('#eee8d5')
      expect(theme.colors.selectionForeground).toBe('#000000')
    })

    it('honors an explicit selectionForeground override', () => {
      const theme = createLogInkTheme({
        colors: { selectionForeground: '#abcdef' },
        env: { COLORTERM: 'truecolor' },
        preset: 'catppuccin',
      })
      expect(theme.colors.selectionForeground).toBe('#abcdef')
    })

    it('sets no selection foreground for no-color themes', () => {
      const theme = createLogInkTheme({ noColor: true, preset: 'catppuccin' })
      expect(theme.colors.selectionForeground).toBeUndefined()
    })
  })
})
