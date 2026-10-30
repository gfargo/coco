/**
 * Hand the terminal to an external editor and take it back (#1871).
 *
 * The workstation runs in the alt screen with the TTY in raw mode and Ink
 * reading stdin through a `'readable'` listener. To run `$EDITOR` it has to
 * leave the alt screen and drop to cooked mode, then undo both afterwards.
 *
 * The part that is easy to get wrong is input. `spawnSync` blocks the event
 * loop, so anything typed while the editor is open sits in the TTY queue.
 * An editor that reads the terminal (vim, nano) consumes it. One that does
 * not (`code -w`, `subl -w`: the window is elsewhere, the terminal still has
 * focus) leaves it there, and the next time stdin is read Ink delivers those
 * keystrokes to the workstation as if they were commands.
 *
 * `stdin.pause()` does not help: Node ignores it while a `'readable'`
 * listener is attached, which is how Ink reads. Instead the listeners are
 * detached for the duration, and once raw mode is back on whatever queued is
 * read and thrown away before they are re-attached.
 */

const ENTER_ALT = '\x1b[?1049h'
const EXIT_ALT = '\x1b[?1049l'
const SHOW_CURSOR = '\x1b[?25h'
const HIDE_CURSOR = '\x1b[?25l'

/**
 * How long the discarding listener stays attached after raw mode is back.
 * The queued bytes are already in the TTY, so they arrive on the next poll;
 * this only has to outlast that, and a genuine keystroke inside the window
 * is lost, so it is kept short.
 */
export const EDITOR_HANDOFF_FLUSH_MS = 50

export type EditorHandoffIO = {
  stdin: NodeJS.ReadStream
  out: Pick<NodeJS.WriteStream, 'write'>
}

type ReadableListener = (...args: unknown[]) => void

function suspendReadableListeners(stdin: NodeJS.ReadStream): () => void {
  const listeners = stdin.listeners('readable') as ReadableListener[]
  for (const listener of listeners) stdin.removeListener('readable', listener)

  return () => {
    const discard = () => {
      while (stdin.read() !== null) {
        // Typed while another program owned the terminal: drop it.
      }
    }
    stdin.on('readable', discard)
    setTimeout(() => {
      stdin.removeListener('readable', discard)
      for (const listener of listeners) stdin.on('readable', listener)
    }, EDITOR_HANDOFF_FLUSH_MS).unref?.()
  }
}

/**
 * Run `run` (a blocking editor spawn) with the terminal handed over, and
 * give it back afterwards even when `run` throws. Returns whatever `run`
 * returns.
 */
export function runWithTerminalHandedOff<T>({ stdin, out }: EditorHandoffIO, run: () => T): T {
  let restoreListeners: (() => void) | undefined
  try {
    // Drop into the primary buffer + cooked mode so the editor doesn't
    // inherit our raw-mode keystrokes.
    stdin.setRawMode?.(false)
    out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
    restoreListeners = suspendReadableListeners(stdin)
    return run()
  } finally {
    out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
    stdin.setRawMode?.(true)
    restoreListeners?.()
  }
}
