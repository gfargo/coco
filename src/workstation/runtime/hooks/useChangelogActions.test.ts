/**
 * Regression coverage for #1593: `startChangelogView` awaited
 * `runChangelogTextWorkflow` inside a `try`/`finally` with no `catch` — an
 * unexpected throw (as opposed to the workflow's own `{ ok: false }`
 * result) would escape as an unhandled promise rejection and strand the
 * changelog view in its loading state forever.
 */
import { useChangelogActions, type UseChangelogActionsDeps } from './useChangelogActions'
import { runChangelogTextWorkflow } from '../../../git/aiActions'

jest.mock('../../../git/aiActions', () => ({
  runChangelogTextWorkflow: jest.fn(),
}))

const runChangelogTextWorkflowMock = runChangelogTextWorkflow as jest.MockedFunction<
  typeof runChangelogTextWorkflow
>

/**
 * Fake React: `useCallback` returns the callback itself; `useRef` is a plain
 * box; `useEffect` runs its setup synchronously once (mirroring mount) since
 * most of these tests don't simulate a render/unmount cycle.
 */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (setup: () => void | (() => void)) => setup(),
  } as unknown as typeof import('react')
}

/** Same as `fakeReact`, but captures the `useEffect` cleanup for manual invocation. */
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

function baseDeps(overrides: Partial<UseChangelogActionsDeps> = {}): UseChangelogActionsDeps {
  return {
    dispatch: jest.fn(),
    context: { branches: { currentBranch: 'main' } } as never,
    changelogCache: {},
    changelogViewText: undefined,
    yankText: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useChangelogActions — defensive catch for an unexpected workflow throw (#1593)', () => {
  it('surfaces a changelog error instead of letting the throw become an unhandled rejection', async () => {
    runChangelogTextWorkflowMock.mockRejectedValue(new Error('boom'))
    const dispatch = jest.fn()
    const { startChangelogView } = useChangelogActions(fakeReact(), baseDeps({ dispatch }))

    await expect(startChangelogView()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setChangelogError',
        error: expect.stringContaining('boom'),
      })
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setStatus', kind: 'error' })
    )
  })
})

/**
 * Regression coverage for WS-3 (#1857): `changelogAbortRef` had no unmount
 * cleanup, so quitting (`q`) while a generation was in flight left the LLM
 * HTTP request pending — the Node event loop wouldn't drain until the
 * provider responded.
 */
describe('useChangelogActions — aborts an in-flight generation on unmount (WS-3)', () => {
  it('aborts the signal passed to runChangelogTextWorkflow when the component unmounts mid-request', async () => {
    let capturedSignal: AbortSignal | undefined
    runChangelogTextWorkflowMock.mockImplementation((_argv, options) => {
      capturedSignal = options?.signal
      return new Promise(() => {}) // never resolves — simulates an in-flight request
    })

    const { react, unmount } = fakeReactWithUnmount()
    const { startChangelogView } = useChangelogActions(react, baseDeps())

    void startChangelogView()
    await Promise.resolve()

    expect(capturedSignal?.aborted).toBe(false)
    unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
