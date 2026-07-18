/**
 * Coverage for `refreshWorktreeContext`'s `worktreeDiffRefreshToken` bump
 * (PR #1646 review, following #1579). The bump used to live at each
 * individual hunk/line-level stage/revert call site in
 * `useWorktreeStageActions.ts`; it's now centralized here — mirroring how
 * `refreshContext` already bumps `setPrDiffRefreshToken` — so every
 * `refreshWorktreeContext` caller, current and future, gets the reload
 * signal automatically instead of each call site having to remember it.
 */
import { useContextRefresh, type UseContextRefreshDeps } from './useContextRefresh'
import { getWorktreeOverview } from '../../../git/statusData'

jest.mock('../../../git/statusData', () => ({
  ...jest.requireActual('../../../git/statusData'),
  getWorktreeOverview: jest.fn(),
}))

const getWorktreeOverviewMock = getWorktreeOverview as jest.MockedFunction<typeof getWorktreeOverview>

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  } as unknown as typeof import('react')
}

function baseDeps(overrides: Partial<UseContextRefreshDeps> = {}): UseContextRefreshDeps {
  return {
    git: {} as never,
    runtimesLength: 1,
    worktree: undefined,
    dispatch: jest.fn(),
    stateRef: { current: {} as never },
    setContext: jest.fn(),
    setContextStatus: jest.fn(),
    setPrDiffRefreshToken: jest.fn(),
    setWorktreeDiffRefreshToken: jest.fn(),
    ...overrides,
  }
}

describe('useContextRefresh — refreshWorktreeContext bumps worktreeDiffRefreshToken centrally (#1579)', () => {
  beforeEach(() => {
    getWorktreeOverviewMock.mockReset()
    getWorktreeOverviewMock.mockResolvedValue({ files: [] } as never)
  })

  it('bumps the token after writing a fresh worktree overview into context', async () => {
    const deps = baseDeps()
    const { refreshWorktreeContext } = useContextRefresh(fakeReact(), deps)

    await refreshWorktreeContext()

    expect(deps.setContext).toHaveBeenCalled()
    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledWith(expect.any(Function))
    // The updater must increment, not just re-set — a same-status
    // worktree mutation with no other changed dep relies on this to
    // actually differ (#1579).
    expect((deps.setWorktreeDiffRefreshToken as jest.Mock).mock.calls[0][0](0)).toBe(1)
  })

  it('does not bump the token when a newer refresh superseded this one', async () => {
    // Two overlapping calls on the same frame: the second claims the
    // request-id slot before the first's `getWorktreeOverview` resolves,
    // so the first's write (and token bump) must be dropped (#1385).
    let resolveFirst: (value: unknown) => void = () => undefined
    getWorktreeOverviewMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }) as never)
      .mockResolvedValueOnce({ files: [] } as never)

    const deps = baseDeps()
    const { refreshWorktreeContext } = useContextRefresh(fakeReact(), deps)

    const first = refreshWorktreeContext()
    await refreshWorktreeContext()
    resolveFirst({ files: [] })
    await first

    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
  })
})

describe('useContextRefresh — refreshWorktreeContext stale-beats-blank on failure (#1617)', () => {
  beforeEach(() => {
    getWorktreeOverviewMock.mockReset()
  })

  it('keeps the previous overview, skips the cache-dropping write, and still returns it', async () => {
    getWorktreeOverviewMock.mockRejectedValue(new Error('index.lock contention'))
    const staleOverview = { files: [{ path: 'a.ts' }] } as never
    const deps = baseDeps({ worktree: staleOverview })
    const { refreshWorktreeContext } = useContextRefresh(fakeReact(), deps)

    const result = await refreshWorktreeContext()

    expect(result).toBe(staleOverview)
    expect(deps.setContext).not.toHaveBeenCalled()
    expect(deps.setWorktreeDiffRefreshToken).not.toHaveBeenCalled()
  })

  it('still restores the status key to ready so the UI does not get stuck loading', async () => {
    getWorktreeOverviewMock.mockRejectedValue(new Error('index.lock contention'))
    const deps = baseDeps({ worktree: { files: [] } as never })
    const { refreshWorktreeContext } = useContextRefresh(fakeReact(), deps)

    await refreshWorktreeContext()

    expect(deps.setContextStatus).toHaveBeenCalledWith(expect.any(Function), 0)
    const statusUpdater = (deps.setContextStatus as jest.Mock).mock.calls.find(
      (call) => call[1] === 0,
    )?.[0]
    expect(statusUpdater).toBeDefined()
  })

  it('writes normally and returns the fresh overview when the fetch succeeds', async () => {
    const fresh = { files: [{ path: 'b.ts' }] } as never
    getWorktreeOverviewMock.mockResolvedValue(fresh)
    const deps = baseDeps({ worktree: { files: [] } as never })
    const { refreshWorktreeContext } = useContextRefresh(fakeReact(), deps)

    const result = await refreshWorktreeContext()

    expect(result).toBe(fresh)
    expect(deps.setContext).toHaveBeenCalled()
    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
  })
})
