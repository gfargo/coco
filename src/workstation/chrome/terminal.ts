import { wrapAsciiOutputStream } from './asciiOutput'

export type LogInkTerminalStreams = {
  input: NodeJS.ReadStream
  output: NodeJS.WriteStream
  error: NodeJS.WriteStream
  /**
   * When true, wrap `output` so every non-ASCII byte written to the
   * terminal is transliterated before it reaches the PTY — the hard
   * backstop behind `theme.ascii` (see `chrome/asciiOutput.ts`).
   */
  ascii?: boolean
}

export type LogInkRenderOptions = {
  alternateScreen: true
  exitOnCtrlC: false
  patchConsole: false
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
}

export function canStartLogInkTui(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream
): boolean {
  return Boolean(input.isTTY && output.isTTY)
}

export function getLogInkRenderOptions(
  streams: LogInkTerminalStreams
): LogInkRenderOptions {
  return {
    alternateScreen: true,
    // Ink's own useInput short-circuits Ctrl+C when this is true (it
    // never reaches any listener — node_modules/ink/build/hooks/use-input.js),
    // which bypasses the unsaved-draft / rebase-plan / split-apply quit
    // guards in getLogInkInputEvents. We own the exit ourselves instead.
    exitOnCtrlC: false,
    patchConsole: false,
    stdin: streams.input,
    stdout: streams.ascii ? wrapAsciiOutputStream(streams.output) : streams.output,
    stderr: streams.ascii ? wrapAsciiOutputStream(streams.error) : streams.error,
  }
}
