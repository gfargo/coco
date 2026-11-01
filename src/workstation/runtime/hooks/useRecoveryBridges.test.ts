import type * as ReactTypes from 'react'
import type { LogInkAction } from '../inkViewModel'
import type { RecoveryRef } from '../errorBoundary'
import { useRecoveryBridges, type UseRecoveryBridgesDeps } from './useRecoveryBridges'

/** Runs each `useEffect` the hook registers, in order, and returns the cleanups. */
function useAndRunEffects(deps: UseRecoveryBridgesDeps): () => void {
  const effects: Array<() => void | (() => void)> = []
  const React = { useEffect: (fn: () => void | (() => void)) => { effects.push(fn) } } as unknown as typeof ReactTypes
  useRecoveryBridges(React, deps)
  const cleanups = effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
  return () => cleanups.forEach((cleanup) => cleanup())
}

describe('useRecoveryBridges (#2206)', () => {
  const base = (overrides: Partial<UseRecoveryBridgesDeps> = {}): UseRecoveryBridgesDeps => ({
    dispatch: jest.fn(),
    composeSummary: '',
    composeBody: '',
    ...overrides,
  })

  describe('error reporting', () => {
    it('points the ref at a status-line error, so an unhandled rejection does not end the session', () => {
      const dispatch = jest.fn()
      const reportErrorRef: ReactTypes.MutableRefObject<((message: string) => void) | null> = { current: null }
      useAndRunEffects(base({ dispatch, reportErrorRef }))

      reportErrorRef.current?.('workflow failed (details: /tmp/crash.log)')
      expect(dispatch).toHaveBeenCalledWith<[LogInkAction]>({ type: 'setStatus', value: 'workflow failed (details: /tmp/crash.log)', kind: 'error' })
    })

    it('clears the ref on cleanup, so a late rejection after unmount reports nowhere', () => {
      const reportErrorRef: ReactTypes.MutableRefObject<((message: string) => void) | null> = { current: null }
      const cleanup = useAndRunEffects(base({ reportErrorRef }))
      expect(reportErrorRef.current).toBeInstanceOf(Function)
      cleanup()
      expect(reportErrorRef.current).toBeNull()
    })
  })

  describe('commit draft', () => {
    it('mirrors the draft being composed, summary and body', () => {
      const recoveryRef: RecoveryRef = { current: {} }
      useAndRunEffects(base({ recoveryRef, composeSummary: '  feat: add thing  ', composeBody: 'Why it matters.' }))
      expect(recoveryRef.current.draft).toBe('feat: add thing\n\nWhy it matters.')
    })

    it('holds a summary alone as just the summary', () => {
      const recoveryRef: RecoveryRef = { current: {} }
      useAndRunEffects(base({ recoveryRef, composeSummary: 'fix: typo' }))
      expect(recoveryRef.current.draft).toBe('fix: typo')
    })

    it('holds nothing for an empty draft, so no empty file is saved', () => {
      const recoveryRef: RecoveryRef = { current: { draft: 'stale' } }
      useAndRunEffects(base({ recoveryRef, composeSummary: '  ', composeBody: '' }))
      expect(recoveryRef.current.draft).toBeUndefined()
    })

    it('follows the draft as it changes', () => {
      const recoveryRef: RecoveryRef = { current: {} }
      useAndRunEffects(base({ recoveryRef, composeSummary: 'one' }))
      useAndRunEffects(base({ recoveryRef, composeSummary: 'one two' }))
      expect(recoveryRef.current.draft).toBe('one two')
    })
  })

  it('does nothing without refs, as in the non-interactive and test seams', () => {
    expect(() => useAndRunEffects(base())).not.toThrow()
  })
})
