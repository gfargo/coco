import { AgentOperationError } from '../../operations/agent/errors'
import { handler } from './handler'

const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockResolveChangeSource = jest.fn()
const mockRunAgentOperation = jest.fn()
const mockCreateRepoChangeWatcher = jest.fn()
const mockCreateThrottledRunner = jest.fn()

jest.mock('../../operations/agent', () => {
  const schemas = jest.requireActual('../../operations/agent/schemas') as typeof import('../../operations/agent/schemas')
  const errors = jest.requireActual('../../operations/agent/errors') as typeof import('../../operations/agent/errors')
  return {
    ...schemas,
    ...errors,
    resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args),
    createAgentOperationContext: (...args: unknown[]) => mockCreateAgentOperationContext(...args),
    resolveChangeSource: (...args: unknown[]) => mockResolveChangeSource(...args),
    runAgentOperation: (...args: unknown[]) => mockRunAgentOperation(...args),
  }
})

jest.mock('../../lib/watcher/repoChangeWatcher', () => ({
  createRepoChangeWatcher: (...args: unknown[]) => mockCreateRepoChangeWatcher(...args),
}))

jest.mock('../../lib/watcher/throttledRunner', () => ({
  // Bypasses real timing: every trigger() runs immediately, matching what a
  // fully-settled cooldown would do, so tests can drive `onChange` directly.
  createThrottledRunner: (...args: unknown[]) => mockCreateThrottledRunner(...args),
}))

function argv(overrides: Record<string, unknown> = {}) {
  return {
    $0: 'coco',
    _: ['watch'],
    interactive: false,
    verbose: false,
    quiet: true,
    json: true,
    version: false,
    help: false,
    review: false,
    draft: false,
    staged: false,
    conventional: false,
    once: false,
    ...overrides,
  } as never
}

const logger = { log: jest.fn(), verbose: jest.fn(), error: jest.fn(), setConfig: jest.fn() } as never

const reviewSuccess = {
  version: 1 as const,
  ok: true as const,
  operation: 'review' as const,
  status: 'completed' as const,
  data: { findings: [] },
  warnings: [],
  meta: { kind: 'repository' as const, digest: 'sha256:v1', verification: 'repository-derived' as const },
}

function resolved(digest: string) {
  return { text: 'diff', meta: { kind: 'repository' as const, digest, verification: 'repository-derived' as const } }
}

describe('watch command handler', () => {
  let stdout: string
  let stdoutSpy: jest.SpyInstance
  let chdirSpy: jest.SpyInstance
  let capturedRun: (() => Promise<void>) | undefined
  let closeMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    stdout = ''
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      stdout += String(chunk)
      return true
    }) as never)
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined)

    mockResolveAgentRepoRoot.mockResolvedValue('/repo')
    mockCreateAgentOperationContext.mockResolvedValue({
      git: { revparse: jest.fn().mockResolvedValue('/repo/.git\n') },
      signal: undefined,
    } as never)
    mockResolveChangeSource.mockResolvedValue(resolved('sha256:v1'))
    mockRunAgentOperation.mockResolvedValue(reviewSuccess)

    closeMock = jest.fn()
    mockCreateRepoChangeWatcher.mockReturnValue({ close: closeMock })
    mockCreateThrottledRunner.mockImplementation((_interval: number, run: () => Promise<void>) => {
      capturedRun = run
      return { trigger: () => { void run() }, close: jest.fn() }
    })
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    chdirSpy.mockRestore()
  })

  function lines(): unknown[] {
    return stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  // The handler registers its SIGINT/SIGTERM listeners only after a chain of
  // awaited setup (repo resolution, context creation, `git.revparse`). A
  // fixed number of `await Promise.resolve()` ticks is brittle against that
  // chain's exact depth, so poll for the listener instead.
  async function waitForShutdownListener(): Promise<void> {
    for (let attempt = 0; attempt < 50 && process.listenerCount('SIGINT') === 0; attempt += 1) {
      await Promise.resolve()
    }
  }

  it('--once resolves the repo, runs the default review operation, and exits', async () => {
    await handler(argv({ once: true }), logger)

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith(undefined)
    expect(chdirSpy).toHaveBeenCalledWith('/repo')
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith({
      repoRoot: '/repo',
      signal: expect.any(AbortSignal),
      surface: 'watch',
    })
    expect(mockRunAgentOperation).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({ source: { kind: 'repository', scope: { type: 'worktree' } } }),
      expect.anything(),
    )
    // Never spins up the continuous fs watcher in one-shot mode.
    expect(mockCreateRepoChangeWatcher).not.toHaveBeenCalled()

    const events = lines()
    expect(events[0]).toMatchObject({ type: 'ready', operations: ['review'], scope: 'worktree' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'running', operation: 'review' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'result', operation: 'review' }))
    expect(events[events.length - 1]).toEqual({ type: 'stopped' })
  })

  it('--draft switches the operation to commit-draft, and --staged scopes the source', async () => {
    mockRunAgentOperation.mockResolvedValue({ ...reviewSuccess, operation: 'commit-draft', data: { title: 't', body: 'b', formatted: 'f', validationErrors: [] } })

    await handler(argv({ once: true, draft: true, staged: true }), logger)

    expect(mockRunAgentOperation).toHaveBeenCalledWith(
      'commit-draft',
      expect.objectContaining({ source: { kind: 'repository', scope: { type: 'staged' } } }),
      expect.anything(),
    )
    const events = lines()
    expect(events[0]).toMatchObject({ operations: ['commit-draft'], scope: 'staged' })
  })

  it('--review --draft runs both operations on the same settled change', async () => {
    await handler(argv({ once: true, review: true, draft: true }), logger)

    const operationsCalled = mockRunAgentOperation.mock.calls.map((call) => call[0])
    expect(operationsCalled).toEqual(['review', 'commit-draft'])
  })

  it('skips the LLM call when the diff digest is unchanged (cost guard)', async () => {
    mockCreateRepoChangeWatcher.mockImplementation(({ onChange }: { onChange: (kind: string) => void }) => {
      // Fire the same digest twice.
      void onChange('worktree')
      return { close: closeMock }
    })

    const handlerPromise = handler(argv(), logger)
    await waitForShutdownListener()
    // Trigger a second settle with the same digest before shutting down.
    await capturedRun?.()
    await capturedRun?.()

    process.emit('SIGINT' as never)
    await handlerPromise

    expect(mockRunAgentOperation).toHaveBeenCalledTimes(1)
    const events = lines()
    expect(events.some((event) => (event as { type: string }).type === 'skipped')).toBe(true)
  })

  it('treats a NO_CHANGES source as idle rather than an error', async () => {
    mockResolveChangeSource.mockRejectedValue(new AgentOperationError('NO_CHANGES', 'No changes were found.'))

    await handler(argv({ once: true }), logger)

    expect(mockRunAgentOperation).not.toHaveBeenCalled()
    const events = lines()
    expect(events).toContainEqual({ type: 'idle' })
  })

  it('emits a structured error event and continues when generation fails', async () => {
    mockRunAgentOperation.mockRejectedValueOnce(new Error('provider unavailable'))

    await handler(argv({ once: true }), logger)

    const events = lines()
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', operation: 'review', code: 'OPERATION_FAILED', message: 'provider unavailable' }),
    )
  })

  it('closes the watcher and throttled runner on SIGINT', async () => {
    const runnerClose = jest.fn()
    mockCreateThrottledRunner.mockReturnValue({ trigger: jest.fn(), close: runnerClose })

    const handlerPromise = handler(argv(), logger)
    await waitForShutdownListener()
    process.emit('SIGINT' as never)
    await handlerPromise

    expect(closeMock).toHaveBeenCalled()
    expect(runnerClose).toHaveBeenCalled()
    const events = lines()
    expect(events[events.length - 1]).toEqual({ type: 'stopped' })
  })
})
