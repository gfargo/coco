/**
 * Regression coverage for #1593: `startCommitSplit` awaited
 * `runCommitSplitPlanWorkflow` inside a `try`/`finally` with no `catch`, and
 * `applyCommitSplit` had no try/catch at all around
 * `runCommitSplitApplyWorkflow`. An unexpected throw (as opposed to the
 * workflow's own `{ ok: false }` result) would escape as an unhandled
 * promise rejection and strand the overlay in its loading state forever.
 */
import {
  useCommitSplitActions,
  type UseCommitSplitActionsDeps,
} from './useCommitSplitActions'
import {
  runCommitSplitApplyWorkflow,
  runCommitSplitPlanWorkflow,
} from '../../../git/commitWorkflowActions'

jest.mock('../../../git/commitWorkflowActions', () => ({
  runCommitSplitPlanWorkflow: jest.fn(),
  runCommitSplitApplyWorkflow: jest.fn(),
}))

const runCommitSplitPlanWorkflowMock = runCommitSplitPlanWorkflow as jest.MockedFunction<
  typeof runCommitSplitPlanWorkflow
>
const runCommitSplitApplyWorkflowMock = runCommitSplitApplyWorkflow as jest.MockedFunction<
  typeof runCommitSplitApplyWorkflow
>

/**
 * Fake React: `useCallback` returns the callback itself; `useRef` is a plain
 * box; `useEffect` runs its setup synchronously once (mirroring mount) since
 * these tests don't simulate a render/unmount cycle.
 */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (setup: () => void) => setup(),
  } as unknown as typeof import('react')
}

function baseDeps(overrides: Partial<UseCommitSplitActionsDeps> = {}): UseCommitSplitActionsDeps {
  return {
    git: {} as never,
    dispatch: jest.fn(),
    context: { worktree: { stagedCount: 1 } } as never,
    splitPlan: undefined,
    refreshContext: jest.fn().mockResolvedValue(undefined),
    refreshHistoryRows: jest.fn().mockResolvedValue(undefined),
    refreshWorktreeContext: jest.fn().mockResolvedValue(undefined),
    mountedRef: { current: true } as never,
    ...overrides,
  }
}

describe('useCommitSplitActions — defensive catches for unexpected workflow throws (#1593)', () => {
  beforeEach(() => {
    runCommitSplitPlanWorkflowMock.mockReset()
    runCommitSplitApplyWorkflowMock.mockReset()
  })

  it('startCommitSplit surfaces a plan error instead of letting the throw become an unhandled rejection', async () => {
    runCommitSplitPlanWorkflowMock.mockRejectedValue(new Error('plan boom'))
    const dispatch = jest.fn()
    const { startCommitSplit } = useCommitSplitActions(fakeReact(), baseDeps({ dispatch }))

    await expect(startCommitSplit()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setSplitPlanError', error: expect.stringContaining('plan boom') })
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setStatus', kind: 'error' })
    )
  })

  it('applyCommitSplit surfaces an apply error instead of letting the throw become an unhandled rejection', async () => {
    runCommitSplitApplyWorkflowMock.mockRejectedValue(new Error('apply boom'))
    const dispatch = jest.fn()
    const splitPlan = {
      status: 'ready' as const,
      plan: { groups: [{ title: 'g1', files: ['a.txt'], hunks: [] }] },
      planContext: {} as never,
      fallback: undefined,
    }
    const { applyCommitSplit } = useCommitSplitActions(
      fakeReact(),
      baseDeps({ dispatch, splitPlan: splitPlan as never })
    )

    await expect(applyCommitSplit()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setSplitPlanError', error: expect.stringContaining('apply boom') })
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setStatus', kind: 'error' })
    )
  })
})

/**
 * Regression coverage for #1627: the `clearRecentCommits` auto-clear timer
 * had no stored handle, so a rapid second apply's markers got wiped early
 * by the FIRST apply's still-counting-down timer, and the dispatch fired
 * unconditionally even after unmount.
 */
describe('useCommitSplitActions — recentCommits timer ownership (#1627)', () => {
  const splitPlan = {
    status: 'ready' as const,
    plan: { groups: [{ title: 'g1', files: ['a.txt'], hunks: [] }] },
    planContext: {} as never,
    fallback: undefined,
  }

  beforeEach(() => {
    runCommitSplitPlanWorkflowMock.mockReset()
    runCommitSplitApplyWorkflowMock.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('a second apply within the first apply timer window keeps its markers for the full 5s', async () => {
    runCommitSplitApplyWorkflowMock
      .mockResolvedValueOnce({ ok: true, message: 'applied', commitHashes: ['first1234'] })
      .mockResolvedValueOnce({ ok: true, message: 'applied', commitHashes: ['second5678'] })
    const dispatch = jest.fn()
    const deps = baseDeps({ dispatch, splitPlan: splitPlan as never })
    const { applyCommitSplit } = useCommitSplitActions(fakeReact(), deps)

    await applyCommitSplit()
    jest.advanceTimersByTime(2000)
    await applyCommitSplit()

    // 3s after the SECOND apply is 5s after the FIRST — the first apply's
    // timer must have been cancelled, so its markers survive this point.
    jest.advanceTimersByTime(3000)
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'clearRecentCommits' }))

    // 5s after the second apply — its own timer fires now.
    jest.advanceTimersByTime(2000)
    const clearCalls = dispatch.mock.calls.filter((call) => call[0]?.type === 'clearRecentCommits')
    expect(clearCalls).toHaveLength(1)
  })

  it('does not dispatch clearRecentCommits after unmount', async () => {
    runCommitSplitApplyWorkflowMock.mockResolvedValueOnce({
      ok: true,
      message: 'applied',
      commitHashes: ['abc1234'],
    })
    const dispatch = jest.fn()
    const mountedRef = { current: true }
    const deps = baseDeps({ dispatch, splitPlan: splitPlan as never, mountedRef: mountedRef as never })
    const { applyCommitSplit } = useCommitSplitActions(fakeReact(), deps)

    await applyCommitSplit()
    mountedRef.current = false
    jest.advanceTimersByTime(5000)

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'clearRecentCommits' }))
  })

  it('clears the pending timer on unmount so it cannot keep the event loop alive', async () => {
    runCommitSplitApplyWorkflowMock.mockResolvedValueOnce({
      ok: true,
      message: 'applied',
      commitHashes: ['def5678'],
    })
    const dispatch = jest.fn()
    const deps = baseDeps({ dispatch, splitPlan: splitPlan as never })
    // The hook now registers two unmount effects (the recentCommits timer
    // and, since WS-3, the plan AbortController) — collect and run both,
    // as a real unmount would.
    const cleanups: Array<() => void> = []
    const react = {
      useCallback: (fn: unknown) => fn,
      useRef: (initial: unknown) => ({ current: initial }),
      useEffect: (setup: () => void | (() => void)) => {
        const cleanup = setup()
        if (typeof cleanup === 'function') {
          cleanups.push(cleanup)
        }
      },
    } as unknown as typeof import('react')
    const { applyCommitSplit } = useCommitSplitActions(react, deps)

    await applyCommitSplit()
    cleanups.forEach((cleanup) => cleanup())

    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(5000)
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'clearRecentCommits' }))
  })
})

/**
 * Regression coverage for WS-3 (#1857): `planAbortRef` had no unmount
 * cleanup, so quitting (`q`) while a split-plan generation was in flight
 * left the LLM HTTP request pending — the Node event loop wouldn't drain
 * until the provider responded.
 */
describe('useCommitSplitActions — aborts an in-flight plan generation on unmount (WS-3)', () => {
  beforeEach(() => {
    runCommitSplitPlanWorkflowMock.mockReset()
  })

  it('aborts the signal passed to runCommitSplitPlanWorkflow when the component unmounts mid-request', async () => {
    let capturedSignal: AbortSignal | undefined
    runCommitSplitPlanWorkflowMock.mockImplementation((input) => {
      capturedSignal = input?.signal
      return new Promise(() => {}) // never resolves — simulates an in-flight request
    })

    let unmount: (() => void) | undefined
    const react = {
      useCallback: (fn: unknown) => fn,
      useRef: (initial: unknown) => ({ current: initial }),
      useEffect: (setup: () => void | (() => void)) => {
        const cleanup = setup()
        if (typeof cleanup === 'function') {
          unmount = cleanup
        }
      },
    } as unknown as typeof import('react')
    const { startCommitSplit } = useCommitSplitActions(react, baseDeps())

    void startCommitSplit()
    await Promise.resolve()

    expect(capturedSignal?.aborted).toBe(false)
    unmount?.()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
