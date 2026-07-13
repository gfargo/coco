import fs from 'fs'
import os from 'os'
import path from 'path'
import { Arguments } from 'yargs'
import { handler } from './handler'
import { ConfigArgv, ConfigOptions } from './config'
import { Logger } from '../../lib/utils/logger'
import { resolveGitRepoRoot } from '../../lib/utils/resolveGitRepoRoot'

jest.mock('../../lib/utils/resolveGitRepoRoot')

const mockResolveGitRepoRoot = resolveGitRepoRoot as jest.MockedFunction<typeof resolveGitRepoRoot>

// `getXdgConfigPath` derives from process.env.XDG_CONFIG_HOME, and
// `loadConfig`'s internal `loadXDGConfig` calls it directly (a same-file
// reference `jest.mock` can't intercept) — so tests point it at a temp
// dir via the real env var rather than mocking the function, keeping the
// scoped-write path (via `resolveScopedConfigPath`) and the effective-read
// path (via `loadConfig`) in agreement about which file is "global".
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    error: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn(),
  } as unknown as Logger
}

function createArgv(overrides: Partial<ConfigOptions> = {}): ConfigArgv {
  return {
    $0: 'coco',
    _: ['config'],
    action: 'get',
    verbose: false,
    version: false,
    help: false,
    json: false,
    ...overrides,
  } as unknown as Arguments<ConfigOptions>
}

describe('config command (#1605)', () => {
  let projectDir: string
  let xdgDir: string
  let fakeHomeDir: string
  let logger: Logger
  let homedirSpy: jest.SpyInstance

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-config-cmd-project-'))
    xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-config-cmd-xdg-'))
    // `loadGitConfig` reads `~/.gitconfig` straight off `os.homedir()` with
    // no env-var override, unlike the XDG loader. Left unmocked, these
    // tests read the REAL developer machine's `~/.gitconfig` — a `[coco]`
    // section set by a prior `coco init` run (e.g. `defaultBranch`) makes
    // "source: default" assertions fail only on that machine, not in a
    // clean sandbox. Point homedir at an empty temp dir so the git layer
    // never contributes here.
    fakeHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-config-cmd-home-'))
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(fakeHomeDir)
    mockResolveGitRepoRoot.mockReturnValue(projectDir)
    process.env.XDG_CONFIG_HOME = xdgDir
    logger = createLogger()
  })

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true })
    fs.rmSync(xdgDir, { recursive: true, force: true })
    fs.rmSync(fakeHomeDir, { recursive: true, force: true })
    homedirSpy.mockRestore()
    if (ORIGINAL_XDG_CONFIG_HOME === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME
    }
    jest.clearAllMocks()
  })

  it('set writes a top-level key into the project scope file', async () => {
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'develop', scope: 'project' }), logger)

    const written = JSON.parse(fs.readFileSync(path.join(projectDir, '.coco.json'), 'utf8'))
    expect(written.defaultBranch).toBe('develop')
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Set defaultBranch'), expect.anything())
  })

  it('set coerces booleans and numbers before writing', async () => {
    await handler(createArgv({ action: 'set', key: 'conventionalCommits', value: 'true', scope: 'project' }), logger)
    await handler(createArgv({ action: 'set', key: 'service.tokenLimit', value: '2048', scope: 'project' }), logger)

    const written = JSON.parse(fs.readFileSync(path.join(projectDir, '.coco.json'), 'utf8'))
    expect(written.conventionalCommits).toBe(true)
    expect(written.service.tokenLimit).toBe(2048)
  })

  it('set rejects an untrusted service key at project scope without writing the file', async () => {
    await expect(
      handler(
        createArgv({ action: 'set', key: 'service.baseURL', value: 'https://evil.example', scope: 'project' }),
        logger
      )
    ).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })

    expect(fs.existsSync(path.join(projectDir, '.coco.json'))).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("can't be set"), expect.anything())
  })

  it('allows the same key at global scope', async () => {
    await handler(
      createArgv({ action: 'set', key: 'service.baseURL', value: 'https://openrouter.ai/api/v1', scope: 'global' }),
      logger
    )

    const written = JSON.parse(fs.readFileSync(path.join(xdgDir, 'coco', 'config.json'), 'utf8'))
    expect(written.service.baseURL).toBe('https://openrouter.ai/api/v1')
  })

  it('set replaces an existing value at the same key rather than duplicating it', async () => {
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'develop', scope: 'project' }), logger)
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'main', scope: 'project' }), logger)

    const written = JSON.parse(fs.readFileSync(path.join(projectDir, '.coco.json'), 'utf8'))
    expect(written.defaultBranch).toBe('main')
  })

  it('unset removes a key while preserving siblings', async () => {
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'develop', scope: 'project' }), logger)
    await handler(createArgv({ action: 'set', key: 'service.model', value: 'gpt-4o', scope: 'project' }), logger)
    await handler(createArgv({ action: 'unset', key: 'defaultBranch', scope: 'project' }), logger)

    const written = JSON.parse(fs.readFileSync(path.join(projectDir, '.coco.json'), 'utf8'))
    expect(written.defaultBranch).toBeUndefined()
    expect(written.service.model).toBe('gpt-4o')
  })

  it('get reports the effective value and its source after a project-scope set', async () => {
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'develop', scope: 'project' }), logger)
    await handler(createArgv({ action: 'get', key: 'defaultBranch' }), logger)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('defaultBranch = "develop"'))
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('source: project'), expect.anything())
  })

  it('get reports "not set" for a key nothing defines', async () => {
    await handler(createArgv({ action: 'get', key: 'nonexistent.key' }), logger)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('is not set'), expect.anything())
  })

  it('get --json emits a structured payload', async () => {
    const writes: string[] = []
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)

    try {
      await handler(createArgv({ action: 'get', key: 'defaultBranch', json: true }), logger)
    } finally {
      writeSpy.mockRestore()
    }

    const parsed = JSON.parse(writes.join(''))
    expect(parsed).toEqual({ key: 'defaultBranch', value: 'main', source: 'default' })
  })

  it('masks an API key value instead of printing it in plain text', async () => {
    // The XDG loader's parseServiceConfig only reconstructs a `service`
    // block when `provider` is present in the same file — set it first so
    // the apiKey round-trips through the real load chain `get` reads from.
    await handler(
      createArgv({ action: 'set', key: 'service.provider', value: 'openai', scope: 'global' }),
      logger
    )
    await handler(
      createArgv({
        action: 'set',
        key: 'service.authentication.credentials.apiKey',
        value: 'sk-real-secret-key',
        scope: 'global',
      }),
      logger
    )
    await handler(createArgv({ action: 'get', key: 'service.authentication.credentials.apiKey' }), logger)

    const loggedLines = (logger.log as jest.Mock).mock.calls.map((call) => call[0] as string)
    expect(loggedLines.some((line) => line.includes('sk-real-secret-key'))).toBe(false)
    expect(loggedLines.some((line) => line.includes('•••'))).toBe(true)
  })

  it('list --scope project prints only that scope\'s raw contents', async () => {
    await handler(createArgv({ action: 'set', key: 'defaultBranch', value: 'develop', scope: 'project' }), logger)
    await handler(createArgv({ action: 'list', scope: 'project' }), logger)

    const loggedLines = (logger.log as jest.Mock).mock.calls.map((call) => call[0] as string)
    expect(loggedLines.some((line) => line.includes('defaultBranch = "develop"'))).toBe(true)
  })
})
