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
  })
})
