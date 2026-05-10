/**
 * Install panic + suspend handlers around an Ink instance so the terminal
 * never gets left in alt-screen / raw-mode / hidden-cursor state when:
 *
 *   - an uncaught exception throws past Ink's render loop (P1.4)
 *   - the user hits Ctrl+Z and the kernel raises SIGTSTP (P1.5)
 *
 * `dispose()` removes every registered listener so a clean exit doesn't
 * leak global handlers on subsequent runs.
 *
 * The escape sequences here are the standard ANSI/xterm trio:
 *   - `\x1b[?25h`  — show the cursor
 *   - `\x1b[?25l`  — hide the cursor
 *   - `\x1b[?1049l` — exit alt screen
 *   - `\x1b[?1049h` — enter alt screen
 */

const SHOW_CURSOR = '\x1b[?25h'
const HIDE_CURSOR = '\x1b[?25l'
const ENTER_ALT_SCREEN = '\x1b[?1049h'
const EXIT_ALT_SCREEN = '\x1b[?1049l'

export type TerminalLifecycleOptions = {
  output: NodeJS.WriteStream
  input: NodeJS.ReadStream
  instance: { unmount: () => void }
  /**
   * Called after the terminal is restored on `SIGCONT`. The runtime
   * uses this to nudge React into re-rendering so the user comes back
   * from `fg` to a painted screen instead of an empty alt buffer.
   */
  onResume?: () => void
  /**
   * Called when a panic is observed and the terminal has been restored,
   * just before `process.exit(1)`. Lets the caller log the error
   * however it sees fit (defaults to printing the stack to stderr).
   */
  onPanic?: (error: unknown) => void
}

export type TerminalLifecycle = {
  dispose: () => void
}

const tryWrite = (output: NodeJS.WriteStream, sequence: string): void => {
  try {
    output.write(sequence)
  } catch {
    // stream may already be closed during shutdown; ignore
  }
}

const trySetRawMode = (input: NodeJS.ReadStream, value: boolean): void => {
  try {
    input.setRawMode?.(value)
  } catch {
    // stdin may not be a TTY; ignore
  }
}

const tryUnmount = (instance: { unmount: () => void }): void => {
  try {
    instance.unmount()
  } catch {
    // Ink may have already cleaned up; ignore
  }
}

export function installTerminalLifecycle(
  options: TerminalLifecycleOptions
): TerminalLifecycle {
  const { input, instance, output } = options

  const restoreTerminal = (): void => {
    // Belt-and-suspenders: tell Ink to unmount AND write the escape
    // sequences directly. Ink's unmount handles most cases but we've
    // seen it leave artifacts when a render is in flight at panic time.
    tryUnmount(instance)
    trySetRawMode(input, false)
    tryWrite(output, `${SHOW_CURSOR}${EXIT_ALT_SCREEN}`)
  }

  const handlePanic = (error: unknown): void => {
    restoreTerminal()
    if (options.onPanic) {
      options.onPanic(error)
    } else if (error instanceof Error) {
      process.stderr.write(`\n${error.stack || error.message}\n`)
    } else {
      process.stderr.write(`\n${String(error)}\n`)
    }
    // Exit with non-zero so callers (CI, scripts) see the failure.
    process.exit(1)
  }

  const onUncaughtException = (error: Error): void => handlePanic(error)
  const onUnhandledRejection = (reason: unknown): void => handlePanic(reason)

  // Ctrl+Z: leave the alt screen + restore the cursor + drop raw mode
  // BEFORE the kernel actually suspends us. We don't unmount Ink — the
  // tree stays alive so SIGCONT can repaint without re-mounting.
  const onSigtstp = (): void => {
    trySetRawMode(input, false)
    tryWrite(output, `${SHOW_CURSOR}${EXIT_ALT_SCREEN}`)
    process.kill(process.pid, 'SIGSTOP')
  }

  // Resume: re-enter alt screen + hide cursor + raw mode back on, then
  // ask the runtime to nudge React so the user lands on a painted screen
  // instead of an empty alt buffer.
  const onSigcont = (): void => {
    tryWrite(output, `${ENTER_ALT_SCREEN}${HIDE_CURSOR}`)
    trySetRawMode(input, true)
    options.onResume?.()
  }

  process.on('uncaughtException', onUncaughtException)
  process.on('unhandledRejection', onUnhandledRejection)
  process.on('SIGTSTP', onSigtstp)
  process.on('SIGCONT', onSigcont)

  return {
    dispose: (): void => {
      process.off('uncaughtException', onUncaughtException)
      process.off('unhandledRejection', onUnhandledRejection)
      process.off('SIGTSTP', onSigtstp)
      process.off('SIGCONT', onSigcont)
    },
  }
}
