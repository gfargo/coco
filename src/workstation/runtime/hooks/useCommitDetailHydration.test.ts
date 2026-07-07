import { getCommitDetail } from '../../../commands/log/data'
import {
    useCommitDetailHydration,
    useCommitDetailState,
} from './useCommitDetailHydration'

/**
 * Behavioral tests for the commit-detail hydration cluster (app.ts
 * decomposition item 1a / #1237). The two hooks are a verbatim lift of the
 * inline `useState` pair + loader effect; these tests drive them through a
 * minimal fake-React harness (the runtime injects `React`) and a mocked data
 * module to prove the contract carried over byte-for-byte:
 *   - no commit cursored → reset detail to `undefined`, never fetch;
 *   - commit cursored → toggle loading, fetch, then store the detail;
 *   - cancellation via the `active` flag suppresses a stale write.
 */

jest.mock('../../../commands/log/data', () => ({
  getCommitDetail: jest.fn(),
}))

const getCommitDetailMock = getCommitDetail as jest.MockedFunction<
  typeof getCommitDetail
>

/** Flush pending microtasks so the effect's awaited `loadDetail` settles. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** Advance fake timers + flush microtasks (for debounced effects). */
const advanceAndFlush = async (ms: number): Promise<void> => {
  jest.advanceTimersByTime(ms)
  await flush()
}

type EffectFn = () => void | (() => void)

/**
 * Records `useEffect` callbacks so the test can invoke them explicitly,
 * mirroring how React would fire them after commit. The hydration hook
 * reaches for `useEffect` and `useRef`; the state hook only for `useState`.
 */
function makeReact(): {
  React: typeof import('react')
  runEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const refs: Array<{ current: unknown }> = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
    useRef: (init: unknown) => {
      const ref = { current: init }
      refs.push(ref)
      return ref
    },
  } as unknown as typeof import('react')
  return {
    React,
    runEffect: () => {
      if (effects.length !== 1) {
        throw new Error(`expected exactly one effect, got ${effects.length}`)
      }
      return effects[0]()
    },
  }
}

const git = {} as Parameters<typeof useCommitDetailHydration>[1]['git']

beforeEach(() => {
  getCommitDetailMock.mockReset()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useCommitDetailState', () => {
  it('seeds detail undefined and detailLoading false, exposing both setters', () => {
    const React = {
      useState: (init: unknown) => {
        const value = typeof init === 'function' ? (init as () => unknown)() : init
        return [value, jest.fn()]
      },
    } as unknown as typeof import('react')

    const result = useCommitDetailState(React)

    expect(result.detail).toBeUndefined()
    expect(result.detailLoading).toBe(false)
    expect(typeof result.setDetail).toBe('function')
    expect(typeof result.setDetailLoading).toBe('function')
  })
})

describe('useCommitDetailHydration', () => {
  it('resets detail + loading to a clean state and never fetches when no commit is cursored', async () => {
    const setDetail = jest.fn()
    const setDetailLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useCommitDetailHydration(React, {
      git,
      selected: undefined,
      setDetail,
      setDetailLoading,
    })
    runEffect()
    await flush()

    expect(setDetail).toHaveBeenCalledWith(undefined)
    // The bail must also clear the loading flag — otherwise a selection that
    // clears mid-fetch leaves the inspector stuck on "Loading commit details…".
    expect(setDetailLoading).toHaveBeenCalledWith(false)
    expect(getCommitDetailMock).not.toHaveBeenCalled()
  })

  it('debounces 120ms, then fetches the cursored commit and stores the detail', async () => {
    const detail = { hash: 'abc123', files: [] }
    getCommitDetailMock.mockResolvedValue(detail as never)
    const setDetail = jest.fn()
    const setDetailLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useCommitDetailHydration(React, {
      git,
      selected: { hash: 'abc123' } as never,
      setDetail,
      setDetailLoading,
    })
    runEffect()

    // Loading flips true synchronously (before debounce fires).
    expect(setDetailLoading).toHaveBeenCalledWith(true)
    // But fetch hasn't fired yet (debounce hasn't elapsed).
    expect(getCommitDetailMock).not.toHaveBeenCalled()

    // Advance past the 120ms debounce + flush the async.
    await advanceAndFlush(150)

    expect(getCommitDetailMock).toHaveBeenCalledWith(git, 'abc123')
    expect(setDetail).toHaveBeenCalledWith(detail)
    expect(setDetailLoading).toHaveBeenLastCalledWith(false)
  })

  it('cancels the debounced fetch when the effect is cleaned up before it fires', async () => {
    getCommitDetailMock.mockResolvedValue({ hash: 'def456', files: [] } as never)
    const setDetail = jest.fn()
    const setDetailLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useCommitDetailHydration(React, {
      git,
      selected: { hash: 'def456' } as never,
      setDetail,
      setDetailLoading,
    })
    const cleanup = runEffect() as () => void

    // Cleanup fires before the debounce elapses (simulating rapid j/k).
    cleanup()
    await advanceAndFlush(150)

    // active === false + timer cleared, so the fetch never fires.
    expect(getCommitDetailMock).not.toHaveBeenCalled()
    // Only the initial setDetailLoading(true) landed.
    expect(setDetail).not.toHaveBeenCalled()
    expect(setDetailLoading).toHaveBeenCalledTimes(1)
    expect(setDetailLoading).toHaveBeenCalledWith(true)
  })
})
