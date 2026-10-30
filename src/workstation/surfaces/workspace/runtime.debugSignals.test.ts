/**
 * #1873 — with `COCO_DEBUG_WORKSPACE` set, the debug handlers registered a
 * `SIGINT` / `SIGTERM` listener that only logged and flushed. A listener
 * replaces Node's default termination, so Ctrl-C stopped killing the
 * process wherever the TTY is in cooked mode (notably while `$EDITOR` runs)
 * and it needed `kill -9`. Debug tracing must observe the signal, not
 * change what it does.
 *
 * `process.on` / `removeListener` / `listenerCount` / `kill` are replaced
 * so no real handler is registered and no real signal is sent.
 */
type Handler = (...args: unknown[]) => void

describe('workspace debug signal handlers (#1873)', () => {
  const registered = new Map<string, Handler[]>()
  const otherListeners = new Map<string, number>()
  let kill: jest.SpyInstance
  let originalDebug: string | undefined

  const listenerCount = (event: string) =>
    (registered.get(event)?.length ?? 0) + (otherListeners.get(event) ?? 0)

  function loadAndInstall() {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const runtime = require('./runtime') as typeof import('./runtime')
      runtime.installWorkspaceDebugHandlers()
    })
  }

  beforeEach(() => {
    registered.clear()
    otherListeners.clear()
    originalDebug = process.env.COCO_DEBUG_WORKSPACE
    process.env.COCO_DEBUG_WORKSPACE = '1'
    jest.spyOn(process, 'on').mockImplementation(((event: string, handler: Handler) => {
      registered.set(event, [...(registered.get(event) ?? []), handler])
      return process
    }) as never)
    jest.spyOn(process, 'removeListener').mockImplementation(((event: string, handler: Handler) => {
      registered.set(event, (registered.get(event) ?? []).filter((h) => h !== handler))
      return process
    }) as never)
    jest.spyOn(process, 'listenerCount').mockImplementation(((event: string) => listenerCount(event)) as never)
    kill = jest.spyOn(process, 'kill').mockImplementation((() => true) as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalDebug === undefined) delete process.env.COCO_DEBUG_WORKSPACE
    else process.env.COCO_DEBUG_WORKSPACE = originalDebug
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('re-delivers %s after flushing so the default action still happens', (signal) => {
    loadAndInstall()
    const [handler] = registered.get(signal) ?? []
    expect(handler).toBeDefined()

    handler()

    expect(kill).toHaveBeenCalledWith(process.pid, signal)
    // Our listener is gone, so the re-delivered signal takes the default path.
    expect(registered.get(signal)).toEqual([])
  })

  it('leaves the signal to another listener when one is registered', () => {
    otherListeners.set('SIGTERM', 1) // e.g. terminalLifecycle's exit(143) handler
    loadAndInstall()
    const [handler] = registered.get('SIGTERM') ?? []

    handler()

    expect(kill).not.toHaveBeenCalled()
  })

  it('does not install anything when debug mode is off', () => {
    delete process.env.COCO_DEBUG_WORKSPACE
    loadAndInstall()
    expect(registered.size).toBe(0)
  })
})
