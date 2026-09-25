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
  exitOnCtrlC: true
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
    exitOnCtrlC: true,
    patchConsole: false,
    stdin: streams.input,
    stdout: streams.ascii ? wrapAsciiOutputStream(streams.output) : streams.output,
    stderr: streams.ascii ? wrapAsciiOutputStream(streams.error) : streams.error,
  }
}
