import { shouldAutoDismissStatus } from './useStatusAutoDismiss'

/**
 * Unit tests for the pure `shouldAutoDismissStatus` core (0.72 app.ts
 * decomposition). No React harness — the hook (`useStatusAutoDismiss`) is
 * a thin timer `useEffect` wrapper around this gate, so testing the pure
 * predicate exercises the modal-open eligibility decision that was lifted
 * verbatim out of app.ts. The timer wiring (4s delay, mountedRef guard,
 * clearTimeout cleanup) is covered by the green build. Mirrors
 * `useSpinnerFrame.test.ts`.
 */

const noModals = {
  statusMessage: 'Pulled current branch' as string | undefined,
  statusKind: undefined as 'info' | 'error' | 'success' | 'warning' | undefined,
  statusLoading: undefined as boolean | undefined,
  inputPrompt: undefined as unknown,
  pendingConfirmationId: undefined as unknown,
  pendingChoice: undefined as unknown,
  showCommandPalette: undefined as unknown,
}

describe('shouldAutoDismissStatus', () => {
  it('returns false when there is no status message', () => {
    expect(shouldAutoDismissStatus({ ...noModals, statusMessage: undefined })).toBe(false)
  })

  it('returns false for an empty-string status message', () => {
    expect(shouldAutoDismissStatus({ ...noModals, statusMessage: '' })).toBe(false)
  })

  it('returns true for a settled message with no modal open', () => {
    expect(shouldAutoDismissStatus(noModals)).toBe(true)
  })

  it('does not dismiss while an input prompt is open', () => {
    expect(shouldAutoDismissStatus({ ...noModals, inputPrompt: { kind: 'branch' } })).toBe(false)
  })

  it('does not dismiss while a y/n confirmation is open', () => {
    expect(shouldAutoDismissStatus({ ...noModals, pendingConfirmationId: 'delete-branch' })).toBe(
      false,
    )
  })

  it('does not dismiss while a multi-choice prompt is open', () => {
    expect(shouldAutoDismissStatus({ ...noModals, pendingChoice: { options: [] } })).toBe(false)
  })

  it('does not dismiss while a mutation confirmation is open', () => {
    expect(
      shouldAutoDismissStatus({ ...noModals, pendingConfirmationId: 'revert-file' }),
    ).toBe(false)
  })

  it('does not dismiss while the command palette is open', () => {
    expect(shouldAutoDismissStatus({ ...noModals, showCommandPalette: true })).toBe(false)
  })

  // Regression: the 4s timer used to clear these too — error messages
  // (with failure reasons / diagnostic log paths) vanished before they
  // could be read, and in-flight progress lines like "generating PR
  // body… Esc to skip" lost both the feedback and the cancel hint
  // mid-call.
  it('never dismisses error statuses', () => {
    expect(shouldAutoDismissStatus({ ...noModals, statusKind: 'error' })).toBe(false)
  })

  it('never dismisses while the status is an in-flight loading line', () => {
    expect(shouldAutoDismissStatus({ ...noModals, statusLoading: true })).toBe(false)
  })

  it('still dismisses success and warning statuses', () => {
    expect(shouldAutoDismissStatus({ ...noModals, statusKind: 'success' })).toBe(true)
    expect(shouldAutoDismissStatus({ ...noModals, statusKind: 'warning' })).toBe(true)
  })
})
