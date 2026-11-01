/**
 * Two small bridges between the app and the code around it that cannot reach
 * React state (#2206).
 *
 * - `reportErrorRef` lets the terminal lifecycle put an unhandled rejection on
 *   the status line instead of ending the session: it calls
 *   `reportErrorRef.current?.(message)`, which this hook points at a
 *   `setStatus` dispatch.
 * - `recoveryRef` carries the commit draft being composed out of the app, so
 *   the error boundary can save it when the app below it throws. Only the
 *   draft is mirrored, and only while it has text; the boundary reads it at
 *   catch time and nothing else observes it.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { LogInkAction } from '../inkViewModel'
import { formatCommitComposeMessage } from '../commitCompose'
import type { RecoveryRef } from '../errorBoundary'

export type UseRecoveryBridgesDeps = {
  dispatch: (action: LogInkAction) => void
  reportErrorRef?: ReactTypes.MutableRefObject<((message: string) => void) | null>
  recoveryRef?: RecoveryRef
  composeSummary: string
  composeBody: string
}

export function useRecoveryBridges(React: typeof ReactTypes, deps: UseRecoveryBridgesDeps): void {
  const { dispatch, reportErrorRef, recoveryRef, composeSummary, composeBody } = deps

  React.useEffect(() => {
    if (!reportErrorRef) return
    reportErrorRef.current = (message: string) => {
      dispatch({ type: 'setStatus', value: message, kind: 'error' })
    }
    return () => {
      reportErrorRef.current = null
    }
  }, [dispatch, reportErrorRef])

  React.useEffect(() => {
    if (!recoveryRef) return
    const draft = formatCommitComposeMessage(composeSummary, composeBody)
    recoveryRef.current.draft = draft || undefined
  }, [recoveryRef, composeSummary, composeBody])
}
