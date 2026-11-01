import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
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

// #2206: an unhandled rejection used to end the session, and with it any
// commit draft in progress. The handlers are registered with process.on, so the
// tests read them off a spy and call them directly rather than emitting a real
// process event into Jest.
describe('installTerminalLifecycle error handling (#2206)', () => {
  const originalCache = process.env.XDG_CACHE_HOME
  let cache: string
  let handlers: Map<string, (...args: unknown[]) => void>
  let exit: jest.SpyInstance
  let stderr: jest.SpyInstance

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-lifecycle-'))
    process.env.XDG_CACHE_HOME = cache
    handlers = new Map()
    jest.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
      return process
    }) as never)
    jest.spyOn(process, 'off').mockImplementation((() => process) as never)
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalCache
    fs.rmSync(cache, { recursive: true, force: true })
  })

  function install(extra: Partial<Parameters<typeof installTerminalLifecycle>[0]> = {}) {
    const instance = { unmount: jest.fn() }
    installTerminalLifecycle({ input: makeInput(), output: makeOutput().stream, instance, ...extra })
    return instance
  }

  it('hands an unhandled rejection to the caller and keeps running', () => {
    const onUnhandledRejection = jest.fn()
    const instance = install({ onUnhandledRejection })
    handlers.get('unhandledRejection')?.(new Error('workflow failed'))

    expect(onUnhandledRejection).toHaveBeenCalledWith(expect.objectContaining({ message: 'workflow failed' }))
    expect(exit).not.toHaveBeenCalled()
    // The terminal was not torn down.
    expect(instance.unmount).not.toHaveBeenCalled()
  })

  it('still treats a rejection as a panic when nobody asked to handle it', () => {
    const instance = install()
    handlers.get('unhandledRejection')?.(new Error('nobody caught this'))

    expect(instance.unmount).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('always treats an uncaught exception as a panic, whatever the rejection option is', () => {
    const onUnhandledRejection = jest.fn()
    install({ onUnhandledRejection })
    handlers.get('uncaughtException')?.(new Error('thrown in a handler'))

    expect(onUnhandledRejection).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('writes a crash log on a panic and points at it, so the stack no longer needs --verbose', () => {
    install()
    handlers.get('uncaughtException')?.(new Error('thrown in a handler'))

    const dir = path.join(cache, 'coco', 'crashes')
    const [name] = fs.readdirSync(dir)
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toContain('thrown in a handler')
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toContain('source:   uncaughtException')
    expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toContain(`coco crashed. Details: ${path.join(dir, name)}`)
  })
})
