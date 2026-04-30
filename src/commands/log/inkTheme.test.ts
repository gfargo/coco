import { createLogInkTheme } from './inkTheme'

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
})
