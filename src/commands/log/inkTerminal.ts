export type LogInkTerminalStreams = {
  input: NodeJS.ReadStream
  output: NodeJS.WriteStream
  error: NodeJS.WriteStream
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
    stdout: streams.output,
    stderr: streams.error,
  }
}
