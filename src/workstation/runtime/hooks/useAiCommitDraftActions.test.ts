/**
 * Regression coverage for WS-3 (#1857): `aiDraftAbortRef` had no unmount
 * cleanup, so quitting (`q`) while an AI commit draft was in flight left
 * the LLM HTTP request pending — the Node event loop wouldn't drain until
 * the provider responded, delaying the shell prompt's return for as long
 * as the request took.
 */
import { useAiCommitDraftActions, type UseAiCommitDraftActionsDeps } from './useAiCommitDraftActions'
import { runCommitDraftWorkflow } from '../../../git/commitWorkflowActions'

jest.mock('../../../git/commitWorkflowActions', () => ({
  runCommitDraftWorkflow: jest.fn(),
}))

const runCommitDraftWorkflowMock = runCommitDraftWorkflow as jest.MockedFunction<
  typeof runCommitDraftWorkflow
>

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box; `useEffect` captures its cleanup. */
function fakeReactWithUnmount(): { react: typeof import('react'); unmount: () => void } {
  let cleanup: (() => void) | undefined
  const react = {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (setup: () => void | (() => void)) => {
      const result = setup()
      if (typeof result === 'function') cleanup = result
    },
  } as unknown as typeof import('react')
  return { react, unmount: () => cleanup?.() }
}

function baseDeps(overrides: Partial<UseAiCommitDraftActionsDeps> = {}): UseAiCommitDraftActionsDeps {
  return {
    git: {} as never,
    dispatch: jest.fn(),
    mountedRef: { current: true },
    ...overrides,
  }
}

describe('useAiCommitDraftActions — aborts an in-flight draft on unmount (WS-3)', () => {
  beforeEach(() => {
    runCommitDraftWorkflowMock.mockReset()
  })

  it('aborts the signal passed to runCommitDraftWorkflow when the component unmounts mid-request', async () => {
    let capturedSignal: AbortSignal | undefined
    runCommitDraftWorkflowMock.mockImplementation((input) => {
      capturedSignal = input?.signal
      return new Promise(() => {}) // never resolves — simulates an in-flight request
    })

    const { react, unmount } = fakeReactWithUnmount()
    const { runAiCommitDraft } = useAiCommitDraftActions(react, baseDeps())

    void runAiCommitDraft()
    await Promise.resolve()

    expect(capturedSignal?.aborted).toBe(false)
    unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
