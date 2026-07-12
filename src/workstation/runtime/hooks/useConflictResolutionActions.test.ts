/**
 * Regression coverage for #1593: `startConflictResolution` awaited
 * `runConflictResolutionWorkflow` inside a `try`/`finally` with no `catch`
 * — an unexpected throw (as opposed to the workflow's own `{ ok: false }`
 * result) would escape as an unhandled promise rejection and strand the
 * conflict-resolution overlay in its loading state forever.
 */
import {
  useConflictResolutionActions,
  type UseConflictResolutionActionsDeps,
} from './useConflictResolutionActions'
import { runConflictResolutionWorkflow } from '../../../git/conflictAiActions'
import { getConflictFileRegions } from '../../../git/conflictRegionActions'

jest.mock('../../../git/conflictAiActions', () => ({
  runConflictResolutionWorkflow: jest.fn(),
}))
jest.mock('../../../git/conflictRegionActions', () => ({
  ...jest.requireActual('../../../git/conflictRegionActions'),
  getConflictFileRegions: jest.fn(),
  applyConflictResolution: jest.fn(),
}))

const runConflictResolutionWorkflowMock = runConflictResolutionWorkflow as jest.MockedFunction<
  typeof runConflictResolutionWorkflow
>
const getConflictFileRegionsMock = getConflictFileRegions as jest.MockedFunction<
  typeof getConflictFileRegions
>

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  } as unknown as typeof import('react')
}

function baseDeps(
  overrides: Partial<UseConflictResolutionActionsDeps> = {}
): UseConflictResolutionActionsDeps {
  return {
    git: {} as never,
    state: { selectedConflictFileIndex: 0 } as never,
    context: {
      operation: { operation: 'merge', conflictedFiles: [{ path: 'src/app.ts' }] },
    } as never,
    dispatch: jest.fn(),
    mountedRef: { current: true },
    refreshContext: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useConflictResolutionActions — defensive catch for an unexpected workflow throw (#1593)', () => {
  beforeEach(() => {
    runConflictResolutionWorkflowMock.mockReset()
    getConflictFileRegionsMock.mockReset()
    getConflictFileRegionsMock.mockResolvedValue({
      ok: true,
      regions: [{ index: 0 } as never],
    } as never)
  })

  it('surfaces a conflict-resolution error instead of letting the throw become an unhandled rejection', async () => {
    runConflictResolutionWorkflowMock.mockRejectedValue(new Error('conflict boom'))
    const dispatch = jest.fn()
    const { startConflictResolution } = useConflictResolutionActions(
      fakeReact(),
      baseDeps({ dispatch })
    )

    await expect(startConflictResolution()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setConflictResolutionError',
        path: 'src/app.ts',
        error: expect.stringContaining('conflict boom'),
      })
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setStatus', kind: 'error' })
    )
  })
})
