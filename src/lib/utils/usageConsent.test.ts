import { decideUsageConsent, isConsentInteractive } from './usageConsent'

describe('decideUsageConsent (#0.69)', () => {
  const base = {
    commandName: 'commit',
    configPreference: undefined as boolean | undefined,
    envOverride: undefined as string | undefined,
    interactive: false,
  }

  it('lets COCO_USAGE_LOG win and never persists, regardless of config', () => {
    expect(decideUsageConsent({ ...base, envOverride: '1', configPreference: false })).toEqual({
      preference: undefined,
      enabledOnFirstRun: false,
    })
    expect(decideUsageConsent({ ...base, envOverride: '/tmp/usage.jsonl', interactive: true })).toEqual({
      preference: undefined,
      enabledOnFirstRun: false,
    })
  })

  it('treats an empty env override as unset', () => {
    expect(decideUsageConsent({ ...base, envOverride: '', configPreference: true })).toEqual({
      preference: true,
      enabledOnFirstRun: false,
    })
  })

  it('honors an explicit config preference without persisting', () => {
    expect(decideUsageConsent({ ...base, configPreference: true })).toEqual({
      preference: true,
      enabledOnFirstRun: false,
    })
    expect(decideUsageConsent({ ...base, configPreference: false })).toEqual({
      preference: false,
      enabledOnFirstRun: false,
    })
  })

  it('does not pre-empt the init command, which runs its own prompt', () => {
    expect(decideUsageConsent({ ...base, commandName: 'init', interactive: true })).toEqual({
      preference: undefined,
      enabledOnFirstRun: false,
    })
  })

  it('defaults on and flags persistence on a first interactive run', () => {
    expect(decideUsageConsent({ ...base, interactive: true })).toEqual({
      preference: true,
      enabledOnFirstRun: true,
    })
  })

  it('stays off and writes nothing on a first non-interactive run', () => {
    expect(decideUsageConsent({ ...base, interactive: false })).toEqual({
      preference: undefined,
      enabledOnFirstRun: false,
    })
  })
})

describe('isConsentInteractive (#0.69)', () => {
  const out = process.stdout.isTTY
  const inp = process.stdin.isTTY
  const ci = process.env.CI

  afterEach(() => {
    ;(process.stdout as { isTTY?: boolean }).isTTY = out
    ;(process.stdin as { isTTY?: boolean }).isTTY = inp
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  })

  it('is interactive only when both stdio ends are TTYs and CI is unset', () => {
    ;(process.stdout as { isTTY?: boolean }).isTTY = true
    ;(process.stdin as { isTTY?: boolean }).isTTY = true
    delete process.env.CI
    expect(isConsentInteractive()).toBe(true)
  })

  it('is not interactive under CI even with TTYs present', () => {
    ;(process.stdout as { isTTY?: boolean }).isTTY = true
    ;(process.stdin as { isTTY?: boolean }).isTTY = true
    process.env.CI = '1'
    expect(isConsentInteractive()).toBe(false)
  })

  it('is not interactive when stdout is not a TTY (piped)', () => {
    ;(process.stdout as { isTTY?: boolean }).isTTY = false
    ;(process.stdin as { isTTY?: boolean }).isTTY = true
    delete process.env.CI
    expect(isConsentInteractive()).toBe(false)
  })
})
