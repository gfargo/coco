import { decideUpdateNotice, isNewerVersion, updateNoticeText } from './updateNotice'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-08-09T12:00:00.000Z')

describe('isNewerVersion', () => {
  it('detects a newer patch/minor/major', () => {
    expect(isNewerVersion('0.87.0', '0.87.1')).toBe(true)
    expect(isNewerVersion('0.87.0', '0.88.0')).toBe(true)
    expect(isNewerVersion('0.87.0', '1.0.0')).toBe(true)
  })

  it('is false for equal or older versions', () => {
    expect(isNewerVersion('0.87.0', '0.87.0')).toBe(false)
    expect(isNewerVersion('0.87.1', '0.87.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.99.9')).toBe(false)
  })

  it('tolerates a leading v and non-numeric prerelease suffixes', () => {
    expect(isNewerVersion('v0.87.0', '0.88.0')).toBe(true)
    expect(isNewerVersion('0.87.0', '0.88.0-beta.1')).toBe(true)
  })
})

describe('decideUpdateNotice', () => {
  const base = {
    currentVersion: '0.87.0',
    latestKnownVersion: undefined as string | undefined,
    lastCheckedAt: undefined as string | undefined,
    now: NOW,
    interactive: true,
    suppressedByFlags: false,
    enabled: true,
  }

  it('checks (but does not notify) when nothing has ever been cached', () => {
    expect(decideUpdateNotice(base)).toEqual({
      shouldCheck: true,
      shouldNotify: false,
      notice: undefined,
    })
  })

  it('notifies once a newer cached version is known', () => {
    const decision = decideUpdateNotice({
      ...base,
      latestKnownVersion: '0.88.0',
      lastCheckedAt: new Date(NOW).toISOString(),
    })
    expect(decision.shouldNotify).toBe(true)
    expect(decision.notice).toBe(updateNoticeText('0.87.0', '0.88.0'))
    // fresh cache (checked just now) — no re-check needed yet.
    expect(decision.shouldCheck).toBe(false)
  })

  it('does not notify when the cached version is not newer', () => {
    const decision = decideUpdateNotice({
      ...base,
      latestKnownVersion: '0.87.0',
      lastCheckedAt: new Date(NOW).toISOString(),
    })
    expect(decision).toEqual({ shouldCheck: false, shouldNotify: false, notice: undefined })
  })

  it('re-checks once the cache is more than 24h stale', () => {
    const decision = decideUpdateNotice({
      ...base,
      latestKnownVersion: '0.87.0',
      lastCheckedAt: new Date(NOW - ONE_DAY_MS - 1).toISOString(),
    })
    expect(decision.shouldCheck).toBe(true)
  })

  it('does not re-check inside the 24h window', () => {
    const decision = decideUpdateNotice({
      ...base,
      latestKnownVersion: '0.87.0',
      lastCheckedAt: new Date(NOW - ONE_DAY_MS + 1).toISOString(),
    })
    expect(decision.shouldCheck).toBe(false)
  })

  it('never checks or notifies when disabled by config', () => {
    const decision = decideUpdateNotice({
      ...base,
      enabled: false,
      latestKnownVersion: '0.88.0',
      lastCheckedAt: undefined,
    })
    expect(decision).toEqual({ shouldCheck: false, shouldNotify: false, notice: undefined })
  })

  it('never checks or notifies when suppressed by --json/--quiet', () => {
    const decision = decideUpdateNotice({
      ...base,
      suppressedByFlags: true,
      latestKnownVersion: '0.88.0',
    })
    expect(decision).toEqual({ shouldCheck: false, shouldNotify: false, notice: undefined })
  })

  it('never checks or notifies on a non-interactive (CI / non-TTY / piped) run', () => {
    const decision = decideUpdateNotice({
      ...base,
      interactive: false,
      latestKnownVersion: '0.88.0',
    })
    expect(decision).toEqual({ shouldCheck: false, shouldNotify: false, notice: undefined })
  })
})
