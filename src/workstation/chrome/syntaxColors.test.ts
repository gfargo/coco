import { resolveSyntaxColor } from './syntaxColors'
import type { LogInkTheme } from './theme'

function theme(overrides: Partial<LogInkTheme['colors']> = {}, noColor = false): LogInkTheme {
  return {
    noColor,
    ascii: false,
    borderStyle: 'round',
    colors: { ...overrides },
  } as LogInkTheme
}

describe('resolveSyntaxColor', () => {
  it('falls back to sensible ANSI defaults when no slot is set', () => {
    const t = theme()
    expect(resolveSyntaxColor('keyword', t)).toBe('magenta')
    expect(resolveSyntaxColor('string', t)).toBe('green')
    expect(resolveSyntaxColor('comment', t)).toBe('gray')
    expect(resolveSyntaxColor('number', t)).toBe('yellow')
    expect(resolveSyntaxColor('type', t)).toBe('cyan')
    expect(resolveSyntaxColor('function', t)).toBe('blue')
    expect(resolveSyntaxColor('constant', t)).toBe('yellow')
  })

  it('prefers a per-theme override slot when defined', () => {
    const t = theme({ syntaxKeyword: '#ff0000', syntaxString: '#00ff00' })
    expect(resolveSyntaxColor('keyword', t)).toBe('#ff0000')
    expect(resolveSyntaxColor('string', t)).toBe('#00ff00')
    // Unset slots still use defaults.
    expect(resolveSyntaxColor('comment', t)).toBe('gray')
  })

  it('returns undefined for plain and property-without-slot', () => {
    const t = theme()
    expect(resolveSyntaxColor('plain', t)).toBeUndefined()
    expect(resolveSyntaxColor('property', t)).toBeUndefined()
  })

  it('returns undefined for every token under noColor themes', () => {
    const t = theme({ syntaxKeyword: '#ff0000' }, true)
    expect(resolveSyntaxColor('keyword', t)).toBeUndefined()
    expect(resolveSyntaxColor('string', t)).toBeUndefined()
  })
})
