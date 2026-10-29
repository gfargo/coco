/**
 * #1870 — `useHistoryRefetch` listed `logArgv` (an object) in its effect
 * deps, so a caller that hands over a fresh-but-equal argv on a re-render
 * fired a full `git log` and bumped `historyRefetchGenerationRef`. That
 * counter is the stale-resolve guard `useDeferredBootLoad` and
 * `useHistoryRefresh` share, so a spurious bump also made their legitimate
 * results look stale and get dropped.
 *
 * Today `LogInkApp` is rendered once, so its `logArgv` prop is stable and
 * nothing triggers this. The hook must not depend on that: only a real
 * change of graph mode, filter, or repo frame is a reason to refetch.
 */
import type { SimpleGit } from 'simple-git'
import type { LogArgv } from '../../../commands/log/config'
import { getLogRows } from '../../../git/logData'
import { getStashCommitHashes } from '../../../git/stashData'
import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { useHistoryRefetch, type UseHistoryRefetchDeps } from './useHistoryRefetch'

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

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('useHistoryRefetch — effect dependencies (#1870)', () => {
  const git = {} as SimpleGit
  // Stable across renders, like the reducer dispatch and state setters.
  const dispatch = jest.fn()
  const setHasMoreCommits = jest.fn()
  const mountedRef = { current: true }
  let generationRef: UseHistoryRefetchDeps['historyRefetchGenerationRef']
  let harness: ReturnType<typeof makeHookHarness>

  const deps = (overrides: Partial<UseHistoryRefetchDeps> = {}): UseHistoryRefetchDeps => ({
    git,
    dispatch,
    logArgv: { interactive: true } as LogArgv,
    fullGraph: false,
    historyFetchArgs: undefined,
    mountedRef,
    setHasMoreCommits,
    historyRefetchGenerationRef: generationRef,
    ...overrides,
  })
  const render = (d: UseHistoryRefetchDeps) =>
    harness.render((React) => useHistoryRefetch(React, d))

  beforeEach(() => {
    getLogRowsMock.mockReset()
    getLogRowsMock.mockResolvedValue([])
    getStashCommitHashesMock.mockReset()
    getStashCommitHashesMock.mockResolvedValue([])
    generationRef = { current: 0 }
    harness = makeHookHarness()
  })

  it('does not refetch or bump the generation when only the argv object identity changes', async () => {
    render(deps())
    render(deps({ logArgv: { interactive: true } as LogArgv }))
    render(deps({ logArgv: { interactive: true } as LogArgv }))
    await flush()

    expect(getLogRowsMock).not.toHaveBeenCalled()
    expect(generationRef.current).toBe(0)
  })

  it('still refetches once when the graph mode changes', async () => {
    render(deps())
    render(deps({ fullGraph: true }))
    await flush()

    expect(getLogRowsMock).toHaveBeenCalledTimes(1)
    expect(generationRef.current).toBe(1)
  })

  it('still refetches once when the repo frame (git) changes', async () => {
    render(deps())
    render(deps({ git: {} as SimpleGit }))
    await flush()

    expect(getLogRowsMock).toHaveBeenCalledTimes(1)
    expect(generationRef.current).toBe(1)
  })

  it('uses the latest argv when a real change triggers the refetch', async () => {
    render(deps())
    render(deps({ fullGraph: true, logArgv: { interactive: true, author: 'later' } as LogArgv }))
    await flush()

    expect(getLogRowsMock.mock.calls[0][1]).toMatchObject({ author: 'later' })
  })
})
