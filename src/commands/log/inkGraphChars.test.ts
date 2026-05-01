import { isPureGraphRow, substituteGraphChars } from './inkGraphChars'

describe('substituteGraphChars', () => {
  it('passes ASCII through unchanged when theme.ascii is true', () => {
    const input = '* | | \\ /'
    expect(substituteGraphChars(input, { ascii: true })).toBe(input)
  })

  it('replaces topology chars with Unicode equivalents when ascii is false', () => {
    const input = '*'
    expect(substituteGraphChars(input, { ascii: false })).toBe('●')
    expect(substituteGraphChars('|', { ascii: false })).toBe('│')
    expect(substituteGraphChars('/', { ascii: false })).toBe('╱')
    expect(substituteGraphChars('\\', { ascii: false })).toBe('╲')
    expect(substituteGraphChars('_', { ascii: false })).toBe('─')
  })

  it('preserves spaces and unmapped characters', () => {
    const input = '*  | (HEAD)'
    expect(substituteGraphChars(input, { ascii: false })).toBe('●  │ (HEAD)')
  })

  it('handles a multi-branch row from git log --graph output', () => {
    const input = '* | |   '
    expect(substituteGraphChars(input, { ascii: false })).toBe('● │ │   ')
  })
})

describe('isPureGraphRow', () => {
  it('returns true for rows with only topology characters', () => {
    expect(isPureGraphRow('|')).toBe(true)
    expect(isPureGraphRow('| | |')).toBe(true)
    expect(isPureGraphRow('|/')).toBe(true)
    expect(isPureGraphRow('| | \\ /')).toBe(true)
  })

  it('returns false for rows containing commit content', () => {
    expect(isPureGraphRow('* abc1234 fix bug')).toBe(false)
    expect(isPureGraphRow('| (HEAD) refs')).toBe(false)
  })

  it('returns false for empty / whitespace-only rows', () => {
    expect(isPureGraphRow('')).toBe(false)
    expect(isPureGraphRow('   ')).toBe(false)
  })
})
