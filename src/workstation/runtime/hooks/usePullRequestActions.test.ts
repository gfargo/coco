/**
 * Regression coverage for #1593: `startCreatePullRequest` awaited
 * `runPullRequestBodyWorkflow` inside a `try`/`finally` with no `catch` —
 * an unexpected throw (as opposed to the workflow's own `{ ok: false }`
 * result) would escape as an unhandled promise rejection. The `finally`
 * still clears the pending flag, but the rejection itself must not
 * escape uncaught.
 */
import {
  usePullRequestActions,
  type UsePullRequestActionsDeps,
} from './usePullRequestActions'
import { runPullRequestBodyWorkflow } from '../../../git/aiActions'

jest.mock('../../../git/aiActions', () => ({
  runPullRequestBodyWorkflow: jest.fn(),
}))

const runPullRequestBodyWorkflowMock = runPullRequestBodyWorkflow as jest.MockedFunction<
  typeof runPullRequestBodyWorkflow
>

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  } as unknown as typeof import('react')
}

function baseDeps(overrides: Partial<UsePullRequestActionsDeps> = {}): UsePullRequestActionsDeps {
  return {
    dispatch: jest.fn(),
    context: {
      branches: { currentBranch: 'feature/x' },
      provider: { repository: { defaultBranch: 'main' } },
    } as never,
    forgeProvider: 'github',
    ...overrides,
  }
}

describe('usePullRequestActions — defensive catch for an unexpected workflow throw (#1593)', () => {
  it('surfaces a failure status instead of letting the throw become an unhandled rejection', async () => {
    runPullRequestBodyWorkflowMock.mockRejectedValue(new Error('pr boom'))
    const dispatch = jest.fn()
    const { startCreatePullRequest } = usePullRequestActions(fakeReact(), baseDeps({ dispatch }))

    await expect(startCreatePullRequest()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setStatus',
        kind: 'error',
        value: expect.stringContaining('pr boom'),
      })
    )
    // The pending flag must still clear even on the unexpected-throw path.
    expect(dispatch).toHaveBeenCalledWith({ type: 'setPendingPullRequestBodyDraft', value: false })
  })
})

describe('usePullRequestActions — Esc cancel gives immediate feedback (#1858)', () => {
  it('clears the pending flag and surfaces a cancelled status without waiting on the workflow', async () => {
    // Regression for #1858: `cancelPullRequestBodyDraft` used to only
    // mutate the soft-cancel handle, dispatching nothing. The loading
    // status line set by `startCreatePullRequest` blocks
    // `useStatusAutoDismiss` from clearing itself, so Esc produced no
    // observable effect until the in-flight LLM call resolved.
    let resolveWorkflow: (value: Awaited<ReturnType<typeof runPullRequestBodyWorkflow>>) => void = () => {}
    runPullRequestBodyWorkflowMock.mockReturnValue(
      new Promise((resolve) => {
        resolveWorkflow = resolve
      })
    )
    const dispatch = jest.fn()
    const { startCreatePullRequest, cancelPullRequestBodyDraft } = usePullRequestActions(
      fakeReact(),
      baseDeps({ dispatch })
    )

    const pending = startCreatePullRequest()

    cancelPullRequestBodyDraft()

    expect(dispatch).toHaveBeenCalledWith({ type: 'setPendingPullRequestBodyDraft', value: false })
    expect(dispatch).toHaveBeenCalledWith({ type: 'setStatus', value: 'PR draft cancelled.' })

    resolveWorkflow({ ok: true, message: 'ok', title: 'title', body: 'body' })
    await pending
  })

  it('is a no-op when no draft is in flight', () => {
    const dispatch = jest.fn()
    const { cancelPullRequestBodyDraft } = usePullRequestActions(fakeReact(), baseDeps({ dispatch }))

    cancelPullRequestBodyDraft()

    expect(dispatch).not.toHaveBeenCalled()
  })
})
