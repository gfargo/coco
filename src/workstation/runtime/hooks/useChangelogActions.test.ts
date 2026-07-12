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

/** Fake React: `useCallback` returns the callback itself; `useRef` is a plain box. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  } as unknown as typeof import('react')
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
