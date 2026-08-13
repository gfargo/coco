/**
 * Coverage for `refreshWorktreeContext`'s `worktreeDiffRefreshToken` bump
 * (PR #1646 review, following #1579). The bump used to live at each
 * individual hunk/line-level stage/revert call site in
 * `useWorktreeStageActions.ts`; it's now centralized here — mirroring how
 * `refreshContext` already bumps `setPrDiffRefreshToken` — so every
 * `refreshWorktreeContext` caller, current and future, gets the reload
 * signal automatically instead of each call site having to remember it.
 */
import { loadLogInkContext, useContextRefresh, type UseContextRefreshDeps } from './useContextRefresh'
import { getWorktreeOverview } from '../../../git/statusData'
import { getForgePullRequestOverview } from '../../../git/forgeActions'
import { getProviderOverview } from '../../../git/providerData'

jest.mock('../../../git/statusData', () => ({
  ...jest.requireActual('../../../git/statusData'),
  getWorktreeOverview: jest.fn(),
}))

jest.mock('../../../git/forgeActions', () => ({
  ...jest.requireActual('../../../git/forgeActions'),
  getForgePullRequestOverview: jest.fn(),
}))

jest.mock('../../../git/providerData', () => ({
  ...jest.requireActual('../../../git/providerData'),
  getProviderOverview: jest.fn(),
}))

const getWorktreeOverviewMock = getWorktreeOverview as jest.MockedFunction<typeof getWorktreeOverview>
const getForgePullRequestOverviewMock = getForgePullRequestOverview as jest.MockedFunction<typeof getForgePullRequestOverview>
const getProviderOverviewMock = getProviderOverview as jest.MockedFunction<typeof getProviderOverview>

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

describe('loadLogInkContext — issues exactly one top-level status --porcelain call (OSS-596)', () => {
  it('fetches status --porcelain -z exactly once regardless of how many consumers accept it', async () => {
    const callLog: string[][] = []

    // A minimal fake SimpleGit that records every git.raw() invocation and
    // returns safe defaults so all the downstream consumers can complete.
    const git = {
      raw: jest.fn().mockImplementation(async (args: string[]) => {
        callLog.push([...args])
        // Return enough data for each consumer to succeed without throwing.
        if (args[0] === 'status') return ''
        if (args[0] === 'branch') return 'main\n'
        if (args[0] === 'for-each-ref') return ''
        if (args[0] === 'tag') return ''
        if (args[0] === 'stash') return ''
        if (args[0] === 'config') throw new Error('no config')
        return ''
      }),
      revparse: jest.fn().mockResolvedValue('/tmp/fake-repo'),
    } as never

    await loadLogInkContext(git)

    // Only the top-level snapshot fetch should have called status --porcelain.
    // getWorktreeListOverview may call `git -C <path> status --porcelain`
    // (args[0] === '-C'), which is legitimately separate — filter to direct
    // status calls only.
    const statusCalls = callLog.filter(
      (args) => args[0] === 'status' && args[1] === '--porcelain',
    )
    expect(statusCalls).toHaveLength(1)
  })
})

describe('loadLogInkContext — silent refresh skips forge/provider network calls (OSS-597)', () => {
  // Minimal fake git that satisfies all non-forge consumers.
  function makeGit() {
    return {
      raw: jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'status') return ''
        if (args[0] === 'branch') return 'main\n'
        if (args[0] === 'for-each-ref') return ''
        if (args[0] === 'tag') return ''
        if (args[0] === 'stash') return ''
        if (args[0] === 'config') throw new Error('no config')
        return ''
      }),
      revparse: jest.fn().mockResolvedValue('/tmp/fake-repo'),
    } as never
  }

  beforeEach(() => {
    getForgePullRequestOverviewMock.mockReset()
    getProviderOverviewMock.mockReset()
    getForgePullRequestOverviewMock.mockResolvedValue({ number: 1 } as never)
    getProviderOverviewMock.mockResolvedValue({ provider: 'github' } as never)
  })

  it('does NOT call getForgePullRequestOverview or getProviderOverview when silent', async () => {
    const git = makeGit()
    await loadLogInkContext(git, { silent: true })

    expect(getForgePullRequestOverviewMock).not.toHaveBeenCalled()
    expect(getProviderOverviewMock).not.toHaveBeenCalled()
  })

  it('omits provider and pullRequest keys from returned object when silent (so merge preserves prior values)', async () => {
    const git = makeGit()
    const result = await loadLogInkContext(git, { silent: true })

    expect(Object.prototype.hasOwnProperty.call(result, 'provider')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(result, 'pullRequest')).toBe(false)
  })

  it('DOES call getForgePullRequestOverview and getProviderOverview when non-silent', async () => {
    const git = makeGit()
    await loadLogInkContext(git, { silent: false })

    expect(getForgePullRequestOverviewMock).toHaveBeenCalledTimes(1)
    expect(getProviderOverviewMock).toHaveBeenCalledTimes(1)
  })

  it('includes provider and pullRequest keys in returned object when non-silent', async () => {
    const git = makeGit()
    const result = await loadLogInkContext(git, { silent: false })

    expect(Object.prototype.hasOwnProperty.call(result, 'provider')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(result, 'pullRequest')).toBe(true)
  })

  it('defaults to non-silent (no options arg) and fetches forge/provider', async () => {
    const git = makeGit()
    await loadLogInkContext(git)

    expect(getForgePullRequestOverviewMock).toHaveBeenCalledTimes(1)
    expect(getProviderOverviewMock).toHaveBeenCalledTimes(1)
  })

  it('preserves prior provider/pullRequest after a silent refresh via merge semantics', async () => {
    const priorContext = {
      provider: { provider: 'github' } as never,
      pullRequest: { number: 42 } as never,
    }
    const git = makeGit()
    const next = await loadLogInkContext(git, { silent: true })

    // Simulate mergeRefreshedContext: { ...prior, ...next }
    const merged = { ...priorContext, ...next }

    // Prior values must survive because next omits the keys entirely.
    expect(merged.provider).toEqual(priorContext.provider)
    expect(merged.pullRequest).toEqual(priorContext.pullRequest)
  })
})

describe('useContextRefresh — refreshContext threads silent into loadLogInkContext (OSS-597)', () => {
  function makeGit() {
    return {
      raw: jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'status') return ''
        if (args[0] === 'branch') return 'main\n'
        if (args[0] === 'for-each-ref') return ''
        if (args[0] === 'tag') return ''
        if (args[0] === 'stash') return ''
        if (args[0] === 'config') throw new Error('no config')
        return ''
      }),
      revparse: jest.fn().mockResolvedValue('/tmp/fake-repo'),
    } as never
  }

  beforeEach(() => {
    getForgePullRequestOverviewMock.mockReset()
    getProviderOverviewMock.mockReset()
    getWorktreeOverviewMock.mockReset()
    getForgePullRequestOverviewMock.mockResolvedValue({ number: 1 } as never)
    getProviderOverviewMock.mockResolvedValue({ provider: 'github' } as never)
    getWorktreeOverviewMock.mockResolvedValue({ files: [] } as never)
  })

  it('does NOT invoke forge/provider when refreshContext is called with silent:true', async () => {
    const git = makeGit()
    const deps = baseDeps({ git })
    const { refreshContext } = useContextRefresh(fakeReact(), deps)

    await refreshContext({ silent: true })

    expect(getForgePullRequestOverviewMock).not.toHaveBeenCalled()
    expect(getProviderOverviewMock).not.toHaveBeenCalled()
  })

  it('DOES invoke forge/provider when refreshContext is called without silent flag', async () => {
    const git = makeGit()
    const deps = baseDeps({ git })
    const { refreshContext } = useContextRefresh(fakeReact(), deps)

    await refreshContext()

    expect(getForgePullRequestOverviewMock).toHaveBeenCalledTimes(1)
    expect(getProviderOverviewMock).toHaveBeenCalledTimes(1)
  })
})
