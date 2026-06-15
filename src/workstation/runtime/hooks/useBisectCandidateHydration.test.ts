import { getCommitDetail } from '../../../commands/log/data'
import {
  useBisectCandidateHydration,
  useBisectCandidateState,
} from './useBisectCandidateHydration'

/**
 * Behavioral tests for the bisect-candidate hydration cluster (app.ts
 * decomposition item 2 / #1237). The two hooks are a verbatim lift of the
 * inline `useState` pair + loader effect; these tests drive them through a
 * minimal fake-React harness and a mocked data module to prove the contract
 * carried over byte-for-byte:
 *   - empty sha → clear detail + loading, never fetch;
 *   - sha present → toggle loading, fetch, then store the detail;
 *   - cancellation via the `active` flag suppresses a stale write.
 */

jest.mock('../../../commands/log/data', () => ({
  getCommitDetail: jest.fn(),
}))

const getCommitDetailMock = getCommitDetail as jest.MockedFunction<
  typeof getCommitDetail
>

/** Flush pending microtasks so the effect's awaited loader settles. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

type EffectFn = () => void | (() => void)

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

const git = {} as Parameters<typeof useBisectCandidateHydration>[1]['git']

beforeEach(() => {
  getCommitDetailMock.mockReset()
})

describe('useBisectCandidateState', () => {
  it('seeds detail undefined and loading false, exposing both setters', () => {
    const React = {
      useState: (init: unknown) => {
        const value = typeof init === 'function' ? (init as () => unknown)() : init
        return [value, jest.fn()]
      },
    } as unknown as typeof import('react')

    const result = useBisectCandidateState(React)

    expect(result.bisectCandidateDetail).toBeUndefined()
    expect(result.bisectCandidateLoading).toBe(false)
    expect(typeof result.setBisectCandidateDetail).toBe('function')
    expect(typeof result.setBisectCandidateLoading).toBe('function')
  })
})

describe('useBisectCandidateHydration', () => {
  it('clears detail + loading and never fetches when the sha is empty', async () => {
    const setBisectCandidateDetail = jest.fn()
    const setBisectCandidateLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useBisectCandidateHydration(React, {
      git,
      bisectCandidateSha: '',
      setBisectCandidateDetail,
      setBisectCandidateLoading,
    })
    runEffect()
    await flush()

    expect(setBisectCandidateDetail).toHaveBeenCalledWith(undefined)
    expect(setBisectCandidateLoading).toHaveBeenCalledWith(false)
    expect(getCommitDetailMock).not.toHaveBeenCalled()
  })

  it('toggles loading, fetches the candidate sha, then stores the detail', async () => {
    const detail = { hash: 'cand123', files: [] }
    getCommitDetailMock.mockResolvedValue(detail as never)
    const setBisectCandidateDetail = jest.fn()
    const setBisectCandidateLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useBisectCandidateHydration(React, {
      git,
      bisectCandidateSha: 'cand123',
      setBisectCandidateDetail,
      setBisectCandidateLoading,
    })
    runEffect()

    // Loading flips true synchronously, before the await.
    expect(setBisectCandidateLoading).toHaveBeenCalledWith(true)
    await flush()

    expect(getCommitDetailMock).toHaveBeenCalledWith(git, 'cand123')
    expect(setBisectCandidateDetail).toHaveBeenCalledWith(detail)
    expect(setBisectCandidateLoading).toHaveBeenLastCalledWith(false)
  })

  it('suppresses a stale write when cleaned up before the fetch resolves', async () => {
    let resolveDetail: (value: unknown) => void = () => {}
    getCommitDetailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve
      }) as never,
    )
    const setBisectCandidateDetail = jest.fn()
    const setBisectCandidateLoading = jest.fn()
    const { React, runEffect } = makeReact()

    useBisectCandidateHydration(React, {
      git,
      bisectCandidateSha: 'cand456',
      setBisectCandidateDetail,
      setBisectCandidateLoading,
    })
    const cleanup = runEffect() as () => void
    cleanup()
    resolveDetail({ hash: 'cand456', files: [] })
    await flush()

    // active === false → only the synchronous loading-true write landed.
    expect(setBisectCandidateDetail).not.toHaveBeenCalled()
    expect(setBisectCandidateLoading).toHaveBeenCalledTimes(1)
    expect(setBisectCandidateLoading).toHaveBeenCalledWith(true)
  })
})
