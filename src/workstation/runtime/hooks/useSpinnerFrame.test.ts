import { computeAnyLoading, type UseSpinnerFrameDeps } from './useSpinnerFrame'

/**
 * Unit tests for the pure `computeAnyLoading` core (0.72 app.ts
 * decomposition). No React harness — the hook (`useSpinnerFrame`) is a
 * thin `useState` + timer `useEffect` wrapper around this gate, so testing
 * the pure boolean-OR exercises the "is anything loading" decision that
 * was lifted verbatim out of app.ts. The timer wiring itself is covered by
 * the green build. Mirrors `useIdleTip.test.ts`.
 */

const allIdle: UseSpinnerFrameDeps = {
  splitPlanStatus: undefined,
  changelogStatus: undefined,
  commitComposeLoading: false,
  remoteOp: undefined,
  statusLoading: undefined,
  pendingItemAction: undefined,
}

describe('computeAnyLoading', () => {
  it('returns false when every loading flag is idle', () => {
    expect(computeAnyLoading(allIdle)).toBe(false)
  })

  it('returns false for non-loading split-plan / changelog statuses', () => {
    expect(
      computeAnyLoading({ ...allIdle, splitPlanStatus: 'ready', changelogStatus: 'ready' }),
    ).toBe(false)
  })

  it('ticks while the split plan is loading', () => {
    expect(computeAnyLoading({ ...allIdle, splitPlanStatus: 'loading' })).toBe(true)
  })

  it('ticks while the split plan is applying', () => {
    expect(computeAnyLoading({ ...allIdle, splitPlanStatus: 'applying' })).toBe(true)
  })

  it('ticks while the changelog view is loading', () => {
    expect(computeAnyLoading({ ...allIdle, changelogStatus: 'loading' })).toBe(true)
  })

  it('ticks while a commit compose draft is loading', () => {
    expect(computeAnyLoading({ ...allIdle, commitComposeLoading: true })).toBe(true)
  })

  it('ticks while a remote op is in flight (truthy coercion)', () => {
    expect(computeAnyLoading({ ...allIdle, remoteOp: { kind: 'push' } })).toBe(true)
  })

  it('ticks while a status refresh is in flight (truthy coercion)', () => {
    expect(computeAnyLoading({ ...allIdle, statusLoading: true })).toBe(true)
  })

  it('ticks while an inline list-item action is pending (truthy coercion)', () => {
    expect(
      computeAnyLoading({ ...allIdle, pendingItemAction: { type: 'delete' } }),
    ).toBe(true)
  })
})
