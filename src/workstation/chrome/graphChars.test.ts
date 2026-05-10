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
  // The 1-to-1 substitution renders these as `│╲` / `│╱` which read as
  // overlapping pipes; the box-drawing junctions ├╮ / ├╯ make it clear
  // that the trunk is forking off / receiving a lane.
  describe('pattern-based junctions (#791)', () => {
    it('emits ├╮ for the |\\ fork pattern', () => {
      expect(substituteGraphChars('|\\', { ascii: false })).toBe('├╮')
    })

    it('emits ├╯ for the |/ converge pattern', () => {
      expect(substituteGraphChars('|/', { ascii: false })).toBe('├╯')
    })

    it('preserves trailing padding around junction patterns', () => {
      expect(substituteGraphChars('|\\  ', { ascii: false })).toBe('├╮  ')
      expect(substituteGraphChars('|/  ', { ascii: false })).toBe('├╯  ')
    })

    it('handles junctions deeper in the row', () => {
      // Lane 0 vertical, lane 1 vertical, lane 2 forking off.
      expect(substituteGraphChars('| | |\\', { ascii: false })).toBe('│ │ ├╮')
      expect(substituteGraphChars('| | |/', { ascii: false })).toBe('│ │ ├╯')
    })

    it('falls back to single-char diagonals when not part of a junction', () => {
      // `\` not preceded by `|` or `*` — keep the legacy diagonal so we
      // do not accidentally render unrelated lane shifts as junctions.
      expect(substituteGraphChars(' \\ ', { ascii: false })).toBe(' ╲ ')
      expect(substituteGraphChars(' / ', { ascii: false })).toBe(' ╱ ')
    })

    it('handles consecutive junctions in the same row', () => {
      // Two adjacent forks: rare in practice but the tokenizer must
      // consume each bigram cleanly without leaking diagonals across
      // lane boundaries.
      expect(substituteGraphChars('|\\|\\', { ascii: false })).toBe('├╮├╮')
    })

    it('renders *\\ and */ commit-row variants with the configured commit glyph', () => {
      // Uncommon — git typically puts the fork on its own row — but
      // when it does emit a commit + diagonal we still want a clean
      // junction so the commit glyph is preserved.
      expect(substituteGraphChars('*\\', { ascii: false })).toBe('●╮')
      expect(substituteGraphChars('*/', { ascii: false })).toBe('●╯')
    })

    it('honors commitGlyph option for stage-3 merge / HEAD glyphs', () => {
      // Stage 3 of #791 will pass ◆ for merges and ◉ for HEAD; verify
      // the option threads through both standalone commits and the
      // commit-with-diagonal patterns.
      expect(substituteGraphChars('*', { ascii: false, commitGlyph: '◆' })).toBe('◆')
      expect(substituteGraphChars('*\\', { ascii: false, commitGlyph: '◉' })).toBe('◉╮')
      expect(substituteGraphChars('| *', { ascii: false, commitGlyph: '◆' })).toBe('│ ◆')
    })

    it('keeps ASCII output untouched even when bigrams are present', () => {
      // ascii bypass is the safety net for legacy terminals — junction
      // tokenization must not run when ascii is true.
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
