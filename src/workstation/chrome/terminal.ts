export type LogInkTerminalStreams = {
  input: NodeJS.ReadStream
  output: NodeJS.WriteStream
  error: NodeJS.WriteStream
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
    stdout: streams.output,
    stderr: streams.error,
  }
}
