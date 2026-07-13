/**
 * Regression coverage for #1612: the resolve-time guard in
 * `useHistoryRefetch` used to check only its own `historyRefetchRequestRef`
 * (this hook's sibling fetches), never the shared
 * `historyRefetchGenerationRef` that `useHistoryRefresh.ts`'s
 * `refreshHistoryRows` also bumps. A slower refetch that resolved AFTER a
 * fresher post-mutation `refreshHistoryRows` still passed its own
 * request-id check and clobbered the newer rows with stale data — the
 * same one-way hazard `isStaleBootLoadResolve` already guards against for
 * the boot loader.
 *
 * Exercised with a fake-React harness that records the registered effect
 * and invokes it directly, with `getLogRows` resolution controlled by hand
 * so a "concurrent generation bump" can be injected mid-flight.
 */
import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getLogRows } from '../../../git/logData'
import { getStashCommitHashes } from '../../../git/stashData'
import { useHistoryRefetch, type UseHistoryRefetchDeps } from './useHistoryRefetch'
import type { LogArgv } from '../../../commands/log/config'

jest.mock('../../../git/logData', () => {
  const actual = jest.requireActual('../../../git/logData')
  return { ...actual, getLogRows: jest.fn() }
})
jest.mock('../../../git/stashData', () => ({
  getStashCommitHashes: jest.fn(),
}))

const getLogRowsMock = getLogRows as jest.MockedFunction<typeof getLogRows>
const getStashCommitHashesMock = getStashCommitHashes as jest.MockedFunction<
  typeof getStashCommitHashes
>

type EffectFn = () => void | (() => void)

/** Fake React: records every `useEffect` registration; each `useRef` call gets its own persistent box. */
function effectsReact(): { React: typeof import('react'); effects: EffectFn[] } {
  const effects: EffectFn[] = []
  const refs: { current: unknown }[] = []
  let refIndex = 0
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
    useRef: (init: unknown) => {
      const idx = refIndex++
      if (!refs[idx]) refs[idx] = { current: init }
      return refs[idx]
    },
  } as unknown as typeof import('react')
  return { React, effects }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function baseDeps(overrides: Partial<UseHistoryRefetchDeps> = {}): UseHistoryRefetchDeps {
  return {
    git: {} as SimpleGit,
    dispatch: jest.fn(),
    logArgv: { interactive: true } as LogArgv,
    fullGraph: false,
    historyFetchArgs: undefined,
    mountedRef: { current: true } as ReactTypes.MutableRefObject<boolean>,
    setHasMoreCommits: jest.fn(),
    historyRefetchGenerationRef: { current: 0 } as ReactTypes.MutableRefObject<number>,
    ...overrides,
  }
}

describe('useHistoryRefetch — reverse staleness guard (#1612)', () => {
  beforeEach(() => {
    getLogRowsMock.mockReset()
    getStashCommitHashesMock.mockReset()
    getStashCommitHashesMock.mockResolvedValue([])
  })

  it('drops a resolve that lands after a concurrent generation bump (a fresher refreshHistoryRows)', async () => {
    let resolveLogRows: ((rows: ReturnType<typeof getLogRows> extends Promise<infer R> ? R : never) => void) | undefined
    getLogRowsMock.mockImplementation(
      () => new Promise((resolve) => { resolveLogRows = resolve })
    )

    const deps = baseDeps()
    const { React, effects } = effectsReact()
    useHistoryRefetch(React, deps)
    expect(effects).toHaveLength(1)
    const [effect] = effects

    // First run is the mount-skip (historyRefetchInitialized flips true, no fetch).
    effect()
    // Second run is a real refetch (e.g. a filter/graph change).
    effect()
    await flush()
    expect(getLogRowsMock).toHaveBeenCalledTimes(1)

    // Simulate a concurrent `refreshHistoryRows` firing and completing
    // (post-mutation) WHILE this refetch is still in flight — it bumps
    // the same shared generation counter.
    deps.historyRefetchGenerationRef.current += 1

    resolveLogRows?.([] as never)
    await flush()

    const dispatchMock = deps.dispatch as jest.Mock
    expect(dispatchMock.mock.calls.some((call) => call[0]?.type === 'replaceRows')).toBe(false)
  })

  it('still applies the resolve when no concurrent generation bump occurred', async () => {
    getLogRowsMock.mockResolvedValue([])

    const deps = baseDeps()
    const { React, effects } = effectsReact()
    useHistoryRefetch(React, deps)
    const [effect] = effects

    effect()
    effect()
    await flush()

    const dispatchMock = deps.dispatch as jest.Mock
    expect(dispatchMock.mock.calls.some((call) => call[0]?.type === 'replaceRows')).toBe(true)
  })
})
