import {
  IDLE_TIPS,
  IDLE_TIPS_GRACE_MS,
  IDLE_TIPS_INTERVAL_MS,
  pickIdleTip,
} from './idleTips'

describe('log Ink idle tips (P4.3)', () => {
  it('exposes the canonical 6+ tip rotation called out in the spec', () => {
    expect(IDLE_TIPS.length).toBeGreaterThanOrEqual(6)
    expect(IDLE_TIPS.length).toBeLessThanOrEqual(8)
    // Each tip is a short scannable hint.
    IDLE_TIPS.forEach((tip) => {
      expect(tip.length).toBeGreaterThan(8)
      expect(tip.length).toBeLessThan(80)
    })
  })

  it('returns undefined for the initial grace tick (0)', () => {
    expect(pickIdleTip(0)).toBeUndefined()
    expect(pickIdleTip(-3)).toBeUndefined()
  })

  it('rotates through the tip list in order starting at tick 1', () => {
    expect(pickIdleTip(1)).toBe(IDLE_TIPS[0])
    expect(pickIdleTip(2)).toBe(IDLE_TIPS[1])
    expect(pickIdleTip(IDLE_TIPS.length)).toBe(IDLE_TIPS[IDLE_TIPS.length - 1])
  })

  it('wraps around the rotation modulo the tip count', () => {
    expect(pickIdleTip(IDLE_TIPS.length + 1)).toBe(IDLE_TIPS[0])
    expect(pickIdleTip(IDLE_TIPS.length * 3 + 2)).toBe(IDLE_TIPS[1])
  })

  it('matches the spec timing constants (>10s grace, ~8s rotation)', () => {
    expect(IDLE_TIPS_GRACE_MS).toBeGreaterThanOrEqual(10_000)
    expect(IDLE_TIPS_INTERVAL_MS).toBeGreaterThanOrEqual(5_000)
    expect(IDLE_TIPS_INTERVAL_MS).toBeLessThanOrEqual(15_000)
  })
})
