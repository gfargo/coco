import { isPureGraphRow, substituteGraphChars } from './graphChars'

describe('substituteGraphChars', () => {
  it('passes ASCII through unchanged when theme.ascii is true', () => {
    const input = '* | | \\ /'
    expect(substituteGraphChars(input, { ascii: true })).toBe(input)
  })

  it('replaces topology chars with Unicode equivalents when ascii is false', () => {
    expect(substituteGraphChars('*', { ascii: false })).toBe('●')
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

  // #791 stage 1 — pattern-based junctions. Real git emits `|\` / `|/`
  // (no space between the pipe and the diagonal) for fork / converge.
  // We render these as diagonals (`│╲` / `│╱`) rather than corner
  // junctions (├╮ / ├╯): git lanes sit on a 2-column pitch and a single
  // diagonal spans that step, so the line stays continuous into the
  // commit above/below. Corners assume a 1-column step and land one
  // column shy of the commit, leaving a detached hook (#791 revisited).
  describe('fork / converge diagonals (#791)', () => {
    it('emits │╲ for the |\\ fork pattern', () => {
      expect(substituteGraphChars('|\\', { ascii: false })).toBe('│╲')
    })

    it('emits │╱ for the |/ converge pattern', () => {
      expect(substituteGraphChars('|/', { ascii: false })).toBe('│╱')
    })

    it('preserves trailing padding around fork / converge patterns', () => {
      expect(substituteGraphChars('|\\  ', { ascii: false })).toBe('│╲  ')
      expect(substituteGraphChars('|/  ', { ascii: false })).toBe('│╱  ')
    })

    it('handles fork / converge deeper in the row', () => {
      // Lane 0 vertical, lane 1 vertical, lane 2 forking off.
      expect(substituteGraphChars('| | |\\', { ascii: false })).toBe('│ │ │╲')
      expect(substituteGraphChars('| | |/', { ascii: false })).toBe('│ │ │╱')
    })

    it('renders standalone diagonals the same as lane diagonals', () => {
      // A `\` / `/` not preceded by `|` or `*` is just a lane shift; it
      // renders as the same diagonal — there is no special-cased junction
      // glyph to drift away from.
      expect(substituteGraphChars(' \\ ', { ascii: false })).toBe(' ╲ ')
      expect(substituteGraphChars(' / ', { ascii: false })).toBe(' ╱ ')
    })

    it('renders *\\ and */ commit-row variants with the configured commit glyph', () => {
      // Uncommon — git typically puts the fork on its own row — but when
      // it does emit a commit + diagonal the commit glyph is preserved
      // and the diagonal carries the branching lane.
      expect(substituteGraphChars('*\\', { ascii: false })).toBe('●╲')
      expect(substituteGraphChars('*/', { ascii: false })).toBe('●╱')
    })

    it('honors commitGlyph option for merge / HEAD glyphs', () => {
      // ◆ for merges and ◉ for HEAD; verify the option threads through
      // both standalone commits and the commit-with-diagonal patterns.
      expect(substituteGraphChars('*', { ascii: false, commitGlyph: '◆' })).toBe('◆')
      expect(substituteGraphChars('*\\', { ascii: false, commitGlyph: '◉' })).toBe('◉╲')
      expect(substituteGraphChars('| *', { ascii: false, commitGlyph: '◆' })).toBe('│ ◆')
    })

    it('keeps ASCII output untouched', () => {
      // ascii bypass is the safety net for legacy terminals.
      expect(substituteGraphChars('|\\', { ascii: true })).toBe('|\\')
      expect(substituteGraphChars('|/', { ascii: true })).toBe('|/')
    })
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
