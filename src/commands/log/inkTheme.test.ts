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
})
