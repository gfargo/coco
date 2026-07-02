import { formatCompactRelativeDate, COMPACT_RELATIVE_DATE_MAX_WIDTH } from './dateFormat'

describe('formatCompactRelativeDate', () => {
  // Regression: days 360-364 floor to 12 "months" but 0 "years"; the
  // old `months < 12` gate fell through to the year branch and rendered
  // a nonsense `0y`.
  it('renders 12mo (not 0y) for commits aged 360-364 days', () => {
    const NOW = new Date('2026-05-14T12:00:00Z')
    expect(formatCompactRelativeDate('2025-05-19', NOW)).toBe('12mo')
  })

  it('rolls to 1y at 365 days', () => {
    const NOW = new Date('2026-05-14T12:00:00Z')
    expect(formatCompactRelativeDate('2025-05-14', NOW)).toBe('1y')
  })

  const NOW = new Date(Date.UTC(2026, 4, 14)) // 2026-05-14

  it('returns today for the same UTC day', () => {
    expect(formatCompactRelativeDate('2026-05-14', NOW)).toBe('today')
  })

  it('returns N d for 1-13 day spans', () => {
    expect(formatCompactRelativeDate('2026-05-13', NOW)).toBe('1d')
    expect(formatCompactRelativeDate('2026-05-01', NOW)).toBe('13d')
  })

  it('switches to weeks at 14 days', () => {
    expect(formatCompactRelativeDate('2026-04-30', NOW)).toBe('2w')
    expect(formatCompactRelativeDate('2026-03-20', NOW)).toBe('7w')
  })

  it('switches to months past 8 weeks', () => {
    // 2026-05-14 minus 90 days = 2026-02-13 → 90/30 = 3mo
    expect(formatCompactRelativeDate('2026-02-13', NOW)).toBe('3mo')
  })

  it('switches to years past 12 months', () => {
    // 2 years back, give or take leap days
    expect(formatCompactRelativeDate('2024-05-14', NOW)).toBe('2y')
    expect(formatCompactRelativeDate('2020-01-01', NOW)).toBe('6y')
  })

  it('collapses future-dated inputs to today (tolerates clock skew)', () => {
    expect(formatCompactRelativeDate('2026-06-01', NOW)).toBe('today')
  })

  it('returns empty string for malformed or missing input', () => {
    expect(formatCompactRelativeDate(undefined, NOW)).toBe('')
    expect(formatCompactRelativeDate('', NOW)).toBe('')
    expect(formatCompactRelativeDate('not a date', NOW)).toBe('')
  })

  it('accepts ISO timestamps with a time component (uses only the date)', () => {
    expect(formatCompactRelativeDate('2026-05-13T09:00:00Z', NOW)).toBe('1d')
  })

  it('outputs never exceed COMPACT_RELATIVE_DATE_MAX_WIDTH', () => {
    const samples = [
      '2026-05-14', '2026-05-01', '2026-04-30', '2026-02-13',
      '2024-05-14', '2010-01-01',
    ]
    for (const iso of samples) {
      const out = formatCompactRelativeDate(iso, NOW)
      expect(out.length).toBeLessThanOrEqual(COMPACT_RELATIVE_DATE_MAX_WIDTH)
    }
  })
})
