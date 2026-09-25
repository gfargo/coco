import { PassThrough } from 'stream'
import { canStartLogInkTui, getLogInkRenderOptions } from './terminal'

function readStream(isTTY: boolean): NodeJS.ReadStream {
  return Object.assign(new PassThrough(), { isTTY }) as unknown as NodeJS.ReadStream
}

function writeStream(isTTY: boolean): NodeJS.WriteStream {
  return Object.assign(new PassThrough(), { isTTY }) as unknown as NodeJS.WriteStream
}

describe('log Ink terminal hygiene', () => {
  it('only starts the full-screen TUI when input and output are TTYs', () => {
    expect(canStartLogInkTui(readStream(true), writeStream(true))).toBe(true)
    expect(canStartLogInkTui(readStream(false), writeStream(true))).toBe(false)
    expect(canStartLogInkTui(readStream(true), writeStream(false))).toBe(false)
  })

  it('uses alternate screen and avoids stdout console patching', () => {
    const input = readStream(true)
    const output = writeStream(true)
    const error = writeStream(true)

    expect(getLogInkRenderOptions({ input, output, error })).toEqual({
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
      stdin: input,
      stdout: output,
      stderr: error,
    })
  })

  it('wraps both stdout and stderr with the ASCII backstop when ascii: true', () => {
    // stderr shares the PTY with stdout — leaving it unwrapped would let
    // unicode written there (warnings, uncaught errors) land on screen and
    // fail an ASCII-mode assertion nondeterministically.
    const input = readStream(true)
    const output = writeStream(true)
    const error = writeStream(true)

    const options = getLogInkRenderOptions({ input, output, error, ascii: true })

    expect(options.stdout).not.toBe(output)
    expect(options.stderr).not.toBe(error)
  })
})
