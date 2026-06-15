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
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

type EffectFn = () => void | (() => void)

/**
 * Records `useEffect` callbacks so the test can invoke them explicitly,
 * mirroring how React would fire them after commit. The hydration hook only
 * reaches for `useEffect`; the state hook only reaches for `useState`.
 */
function makeReact(): {
  React: typeof import('react')
  runEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
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
  it('resets detail to undefined and never fetches when no commit is cursored', async () => {
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
    expect(setDetailLoading).not.toHaveBeenCalled()
    expect(getCommitDetailMock).not.toHaveBeenCalled()
  })

  it('toggles loading, fetches the cursored commit, then stores the detail', async () => {
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

    // Loading flips true synchronously, before the await.
    expect(setDetailLoading).toHaveBeenCalledWith(true)
    await flush()

    expect(getCommitDetailMock).toHaveBeenCalledWith(git, 'abc123')
    expect(setDetail).toHaveBeenCalledWith(detail)
    expect(setDetailLoading).toHaveBeenLastCalledWith(false)
  })

  it('suppresses a stale write when the effect is cleaned up before the fetch resolves', async () => {
    let resolveDetail: (value: unknown) => void = () => {}
    getCommitDetailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve
      }) as never,
    )
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
    cleanup()
    resolveDetail({ hash: 'def456', files: [] })
    await flush()

    // active === false, so neither the detail nor the loading-false write lands.
    expect(setDetail).not.toHaveBeenCalled()
    expect(setDetailLoading).toHaveBeenCalledTimes(1)
    expect(setDetailLoading).toHaveBeenCalledWith(true)
  })
})
