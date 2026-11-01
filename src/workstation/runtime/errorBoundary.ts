/**
 * App-level error boundary for the workstation (#2206).
 *
 * A throw while rendering, or in an effect, used to reach Ink's own boundary,
 * which draws its overview on the alt screen and then unmounts. The alt screen
 * is thrown away with it, so the user saw a one-line `Error: ...` and nothing
 * else, and any commit draft in progress was lost.
 *
 * This boundary sits inside Ink's, so it catches first. It writes the stack to
 * a crash log (and saves the commit draft), then shows a panel that says what
 * happened and where the log is: `r` reloads the view, `q` quits. Reloading
 * remounts the app from scratch, which is why a draft is saved first. If the
 * reloaded view keeps failing straight away, the reload is withdrawn after a few
 * tries rather than looping.
 *
 * Errors thrown in input handlers and timers are not render errors and never
 * reach a boundary; those go through `terminalLifecycle`.
 *
 * `React` and `ink` are injected, as everywhere in the runtime, because the
 * workstation never statically imports either. Ink's hooks are used only through
 * `ink`, so the panel is a plain function the tests can call directly.
 */

import type * as ReactTypes from 'react'
import { summarizeError, writeCrashLog } from '../../lib/utils/crashLog'
import type { LogInkInputKey } from './inkInput'
import type { LogInkRuntime } from './types'

/** Written by the app, read by the boundary when it catches. */
export type RecoveryRef = { current: { draft?: string } }

/** A failure within this long of a reload counts as the reload failing. */
export const RECOVERY_QUICK_FAILURE_MS = 3000
/** After this many reloads in a row that fail at once, `r` is withdrawn. */
export const RECOVERY_MAX_QUICK_FAILURES = 3

export type RecoveryPanelProps = {
  error: unknown
  /** Whether the crash log write has finished, so "could not be written" is only said once it is true. */
  logResolved: boolean
  logPath?: string
  draftPath?: string
  canRetry: boolean
  onRetry: () => void
}

type BoundaryProps = {
  recoveryRef?: RecoveryRef
  children?: ReactTypes.ReactNode
}

type BoundaryState = {
  hasError: boolean
  error?: unknown
  logResolved: boolean
  logPath?: string
  draftPath?: string
  /** Reloads in a row that failed straight away. */
  quickFailures: number
  /** Changing it remounts the children. */
  generation: number
}

export function createErrorBoundary(React: typeof ReactTypes, ink: LogInkRuntime['ink']) {
  const { Box, Text } = ink
  const h = React.createElement

  function RecoveryPanel(props: RecoveryPanelProps): ReactTypes.ReactElement {
    const app = ink.useApp()
    ink.useInput((input: string, key: LogInkInputKey) => {
      if (input === 'q' || (key.ctrl && input === 'c')) {
        app.exit()
      } else if (input === 'r' && props.canRetry) {
        props.onRetry()
      }
    })

    return h(Box, { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
      h(Text, { bold: true }, 'coco hit an error and stopped this view'),
      h(Text, undefined, ''),
      h(Text, undefined, summarizeError(props.error)),
      h(Text, undefined, ''),
      // The panel paints once before the log is written: say nothing then,
      // rather than that it could not be.
      h(Text, { dimColor: true }, props.logPath
        ? `Details: ${props.logPath}`
        : props.logResolved ? 'A crash log could not be written.' : ''),
      ...(props.draftPath
        ? [h(Text, { key: 'draft' }, `Your commit draft was saved to ${props.draftPath}`)]
        : []),
      h(Text, undefined, ''),
      h(Text, { bold: true }, props.canRetry
        ? 'r reload the view   q quit'
        : 'q quit'),
      h(Text, { dimColor: true }, props.canRetry
        ? 'Reloading restarts the view; anything unsaved in it is lost.'
        : 'Reloading failed again each time, so it is no longer offered.'))
  }

  class Boundary extends React.Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { hasError: false, logResolved: false, quickFailures: 0, generation: 0 }

    /**
     * When the last reload happened, to tell a failing reload from a new
     * failure. Not `private`: the class is exported by inference.
     */
    retriedAt = 0

    static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
      return { hasError: true, error }
    }

    componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
      const record = writeCrashLog({
        source: 'render',
        error,
        componentStack: info.componentStack ?? undefined,
        draft: this.props.recoveryRef?.current.draft,
      })
      const failedAfterReload = this.retriedAt > 0 && Date.now() - this.retriedAt < RECOVERY_QUICK_FAILURE_MS
      this.setState((current) => ({
        logResolved: true,
        logPath: record.logPath,
        draftPath: record.draftPath,
        quickFailures: failedAfterReload ? current.quickFailures + 1 : 1,
      }))
    }

    retry = (): void => {
      this.retriedAt = Date.now()
      this.setState((current) => ({
        hasError: false,
        error: undefined,
        logResolved: false,
        logPath: undefined,
        draftPath: undefined,
        generation: current.generation + 1,
      }))
    }

    render(): ReactTypes.ReactNode {
      if (this.state.hasError) {
        return h(RecoveryPanel, {
          error: this.state.error,
          logResolved: this.state.logResolved,
          logPath: this.state.logPath,
          draftPath: this.state.draftPath,
          canRetry: this.state.quickFailures < RECOVERY_MAX_QUICK_FAILURES,
          onRetry: this.retry,
        })
      }
      return h(React.Fragment, { key: this.state.generation }, this.props.children)
    }
  }

  return { Boundary, RecoveryPanel }
}
