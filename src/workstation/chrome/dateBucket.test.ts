import { getDateBucket } from './dateBucket'

describe('getDateBucket', () => {
  // Fix `now` to a mid-month Thursday so all buckets are reachable
  // without overflowing month boundaries in the assertions.
  const NOW = new Date(Date.UTC(2026, 4, 14)) // 2026-05-14

  it('returns today for the same UTC day', () => {
    expect(getDateBucket('2026-05-14', NOW)).toEqual({ key: 'today', label: 'Today' })
  })

  it('returns yesterday for exactly 1 day ago', () => {
    expect(getDateBucket('2026-05-13', NOW)).toEqual({ key: 'yesterday', label: 'Yesterday' })
  })

  it('returns this-week for 2-6 days ago', () => {
    expect(getDateBucket('2026-05-12', NOW)).toEqual({ key: 'this-week', label: 'This week' })
    expect(getDateBucket('2026-05-08', NOW)).toEqual({ key: 'this-week', label: 'This week' })
  })

  it('returns last-week for 7-13 days ago', () => {
    expect(getDateBucket('2026-05-07', NOW)).toEqual({ key: 'last-week', label: 'Last week' })
    expect(getDateBucket('2026-05-01', NOW)).toEqual({ key: 'last-week', label: 'Last week' })
  })

  it('returns earlier-this-month for older days in the current calendar month', () => {
    // 2026-04-30 → calendar April; NOW is May → different bucket.
    // 2026-05-01 is in May but within last-week range, so bucket is
    // last-week. Use a date that's both in current month AND > 13d.
    const earlyNow = new Date(Date.UTC(2026, 4, 30)) // 2026-05-30
    expect(getDateBucket('2026-05-01', earlyNow)).toEqual({
      key: 'earlier-this-month',
      label: 'Earlier this month',
    })
  })

  it('returns a month-specific bucket for older months', () => {
    expect(getDateBucket('2026-04-30', NOW)).toEqual({
      key: 'month-2026-04',
      label: 'April 2026',
    })
    expect(getDateBucket('2024-12-25', NOW)).toEqual({
      key: 'month-2024-12',
      label: 'December 2024',
    })
  })

  it('treats different months in different bucket keys', () => {
    const aprilBucket = getDateBucket('2026-04-10', NOW)
    const marchBucket = getDateBucket('2026-03-10', NOW)
    expect(aprilBucket.key).not.toBe(marchBucket.key)
  })

  it('collapses future-dated commits to today (clock skew tolerance)', () => {
    expect(getDateBucket('2026-06-01', NOW)).toEqual({ key: 'today', label: 'Today' })
  })

  it('returns unknown bucket for malformed inputs', () => {
    expect(getDateBucket(undefined, NOW).key).toBe('unknown')
    expect(getDateBucket('', NOW).key).toBe('unknown')
    expect(getDateBucket('not a date', NOW).key).toBe('unknown')
  })

  it('accepts ISO timestamps with a time component', () => {
    expect(getDateBucket('2026-05-13T09:00:00Z', NOW)).toEqual({
      key: 'yesterday',
      label: 'Yesterday',
    })
  })
})
