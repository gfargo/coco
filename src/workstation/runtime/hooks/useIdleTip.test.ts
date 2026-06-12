import { resolveIdleTip } from './useIdleTip'
import { IDLE_TIPS } from '../../chrome/idleTips'

/**
 * Unit tests for the pure `resolveIdleTip` core (0.72 app.ts
 * decomposition). No React harness — the hook (`useIdleTip`) is a thin
 * `useState` + timer `useEffect` wrapper around this gate, so testing the
 * pure derivation exercises the tip-eligibility decision (tips enabled,
 * no active statusMessage) and the `pickIdleTip` provider hand-off that
 * were lifted verbatim out of app.ts. The timer wiring itself is covered
 * by the green build. Mirrors `buildFilteredLists.test.ts`.
 */

describe('resolveIdleTip', () => {
  it('returns undefined when idle tips are disabled', () => {
    expect(resolveIdleTip(1, false, undefined, undefined)).toBeUndefined()
  })

  it('returns undefined while a statusMessage is active', () => {
    expect(resolveIdleTip(1, true, 'committing…', undefined)).toBeUndefined()
  })

  it('returns undefined at tickIndex 0 (initial grace window)', () => {
    expect(resolveIdleTip(0, true, undefined, undefined)).toBeUndefined()
  })

  it('returns undefined at tickIndex 0 even when statusMessage is empty string', () => {
    expect(resolveIdleTip(0, true, '', undefined)).toBeUndefined()
  })

  it('returns the first tip at tickIndex 1 when enabled and idle', () => {
    expect(resolveIdleTip(1, true, undefined, undefined)).toBe(IDLE_TIPS[0])
  })

  it('rotates through tips on the same cadence as pickIdleTip', () => {
    expect(resolveIdleTip(2, true, undefined, undefined)).toBe(IDLE_TIPS[1])
    expect(resolveIdleTip(IDLE_TIPS.length, true, undefined, undefined)).toBe(
      IDLE_TIPS[IDLE_TIPS.length - 1],
    )
    // wraps after a full cycle
    expect(resolveIdleTip(IDLE_TIPS.length + 1, true, undefined, undefined)).toBe(
      IDLE_TIPS[0],
    )
  })

  it('substitutes the forge noun via the provider argument', () => {
    const githubTip = resolveIdleTip(10, true, undefined, 'github')
    const gitlabTip = resolveIdleTip(10, true, undefined, 'gitlab')
    // The {abbrev} placeholder tip (index 9) renders PR on GitHub, MR on GitLab.
    expect(githubTip).toContain('PR')
    expect(gitlabTip).toContain('MR')
    expect(githubTip).not.toEqual(gitlabTip)
  })
})
