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

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
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
