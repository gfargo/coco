import { PassThrough } from 'stream'
import { installTerminalLifecycle } from './terminalLifecycle'

const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h'
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1006l'

function makeOutput(): { stream: NodeJS.WriteStream; written: string } {
  const state = { written: '' }
  const stream = Object.assign(new PassThrough(), {
    columns: 120,
    rows: 40,
  }) as unknown as NodeJS.WriteStream
  const originalWrite = stream.write.bind(stream)
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    state.written += String(chunk)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalWrite(chunk as any, ...(rest as any))
  }) as typeof stream.write
  return {
    stream,
    get written() {
      return state.written
    },
  } as unknown as { stream: NodeJS.WriteStream; written: string }
}

function makeInput(): NodeJS.ReadStream {
  return Object.assign(new PassThrough(), { isTTY: true, setRawMode: jest.fn() }) as unknown as NodeJS.ReadStream
}

describe('installTerminalLifecycle mouse mode (OSS-1608)', () => {
  it('writes the SGR mouse-enable sequence on install when mouse is on', () => {
    const output = makeOutput()
    const input = makeInput()
    const lifecycle = installTerminalLifecycle({
      input,
      output: output.stream,
      instance: { unmount: jest.fn() },
      mouse: true,
    })

    expect(output.written).toContain(ENABLE_MOUSE)
    lifecycle.dispose()
  })

  it('writes nothing when mouse is off (byte-identical to no mouse support)', () => {
    const output = makeOutput()
    const input = makeInput()
    const lifecycle = installTerminalLifecycle({
      input,
      output: output.stream,
      instance: { unmount: jest.fn() },
    })

    expect(output.written).toBe('')
    lifecycle.dispose()
    expect(output.written).toBe('')
  })

  it('writes the SGR mouse-disable sequence on dispose (clean exit) when mouse is on', () => {
    const output = makeOutput()
    const input = makeInput()
    const lifecycle = installTerminalLifecycle({
      input,
      output: output.stream,
      instance: { unmount: jest.fn() },
      mouse: true,
    })

    lifecycle.dispose()
    expect(output.written).toContain(DISABLE_MOUSE)
  })

  it('disables mouse mode before exiting on SIGTERM when mouse is on', () => {
    const output = makeOutput()
    const input = makeInput()
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const lifecycle = installTerminalLifecycle({
      input,
      output: output.stream,
      instance: { unmount: jest.fn() },
      mouse: true,
    })

    process.emit('SIGTERM')

    expect(output.written).toContain(DISABLE_MOUSE)
    expect(exitSpy).toHaveBeenCalledWith(143)

    lifecycle.dispose()
    exitSpy.mockRestore()
  })
})
