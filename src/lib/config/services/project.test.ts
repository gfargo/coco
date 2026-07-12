import * as fs from 'fs'
import { loadProjectJsonConfig, resetConfigLoadWarnings } from './project'
import { Config } from '../types'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'

jest.mock('fs')
jest.mock('os')
// Real implementation: project.ts joins the resolved repo root with the
// candidate filename via path.join (#1616) — nothing in this file asserts
// on a mocked path.join, so keeping the real behavior lets that join
// actually produce a path instead of `undefined`.
jest.mock('path', () => jest.requireActual('path'))
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))
// Stubbed to a fixed fake root (#1616) so these tests stay fast and
// deterministic instead of shelling out to a real `git rev-parse
// --show-toplevel` against whatever checkout happens to run them.
jest.mock('../../utils/resolveGitRepoRoot')

const mockFs = fs as jest.Mocked<typeof fs>
const mockResolveGitRepoRoot = resolveGitRepoRoot as jest.MockedFunction<typeof resolveGitRepoRoot>

const openAIAliasConfig: Config = {
  service: getDefaultServiceConfigFromAlias('openai'),
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

const ollamaAliasConfig: Config = {
  service: getDefaultServiceConfigFromAlias('ollama', 'mistral'),
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadProjectConfig', () => {
  beforeEach(() => {
    mockResolveGitRepoRoot.mockReturnValue('/fake/repo/root')
  })

  afterEach(() => {
    jest.resetAllMocks()
    // The warn-once guard is process-scoped; reset it so each test
    // exercises the warning paths from a clean slate.
    resetConfigLoadWarnings()
  })

  it('should load project config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai', 'gpt-3.5-turbo') })
    )
    const config = loadProjectJsonConfig(openAIAliasConfig)
    expect(config.service.provider).toBe('openai')
  })

  it('resolves .coco.json against the repo root, not a bare cwd-relative filename (#1616)', () => {
    // `coco init` writes `.coco.json` at the repo root; running a command
    // from a subdirectory used to test the bare relative filename (which
    // resolves against process.cwd(), not the root) and silently drop the
    // whole project config. resolveGitRepoRoot is mocked to a fixed path
    // here specifically so this test does not depend on which directory
    // the test runner's own cwd happens to be.
    mockFs.existsSync.mockImplementation((candidate) => candidate === '/fake/repo/root/.coco.json')
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai', 'gpt-3.5-turbo') })
    )

    const { config, path: resolvedPath } = loadProjectJsonConfig(openAIAliasConfig, {
      returnSource: true,
    })

    expect(mockResolveGitRepoRoot).toHaveBeenCalled()
    expect(resolvedPath).toBe('/fake/repo/root/.coco.json')
    expect(config.service.provider).toBe('openai')
  })

  it('falls back to .coco.config.json at the repo root when .coco.json is absent', () => {
    mockFs.existsSync.mockImplementation(
      (candidate) => candidate === '/fake/repo/root/.coco.config.json'
    )
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai', 'gpt-3.5-turbo') })
    )

    const { path: resolvedPath } = loadProjectJsonConfig(openAIAliasConfig, {
      returnSource: true,
    })

    expect(resolvedPath).toBe('/fake/repo/root/.coco.config.json')
  })

  it('does not crash on a malformed JSON config — warns and falls back', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFs.existsSync.mockReturnValue(true)
    // A stray token — exactly the kind of hand-edit typo a user makes.
    mockFs.readFileSync.mockReturnValue('{ "service": { bad json ]')

    let config: Config | undefined
    expect(() => {
      config = loadProjectJsonConfig(openAIAliasConfig) as Config
    }).not.toThrow()

    // Falls back to the other config sources (here, the passed-in base).
    expect(config?.service.provider).toBe('openai')
    // Warns loudly with the file + the parse reason.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('could not parse')
    expect(warn.mock.calls[0][0]).toContain('.coco.json')
    warn.mockRestore()
  })

  it('warns at most once about a malformed config across repeated loads', () => {
    // Config is loaded several times per command run (command handler,
    // command executor, default router, doctor, …). Each load re-runs
    // loadProjectJsonConfig, which used to print the same parse warning
    // once per load — 3× for a single `coco doctor` invocation. The
    // warn-once guard collapses those to a single warning per run.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('{ this is not valid json ]')

    // Simulate the multiple loads a single command performs.
    loadProjectJsonConfig(openAIAliasConfig)
    loadProjectJsonConfig(openAIAliasConfig)
    loadProjectJsonConfig(openAIAliasConfig)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('could not parse')
    warn.mockRestore()
  })

  it('should load project config with service alias', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('ollama', 'mistral') })
    )
    const config = loadProjectJsonConfig(ollamaAliasConfig)
    expect(config.service.provider).toBe('ollama')
    expect(config.service.model).toBe('mistral')

    if (config.service.provider === 'ollama') {
      expect(config.service.endpoint).toBe('http://localhost:11434')
    }
  })

  it('ignores baseURL/endpoint/authentication/fields set by a repo-local project file', () => {
    // The core exploit: a hostile repo commits a project config that tries
    // to redirect the LLM request (and the real API key attached to it) to
    // an attacker-controlled endpoint. None of these fields may come from
    // repo-local config — only from trusted layers (default/XDG/git/env).
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: {
          baseURL: 'https://attacker.example/v1',
          endpoint: 'https://attacker.example/v1',
          authentication: {
            type: 'APIKey',
            credentials: { apiKey: 'attacker-supplied-key' },
          },
          fields: { configuration: { baseURL: 'https://attacker.example/v1' } },
        },
      })
    )

    const trustedIncoming: Config = {
      ...openAIAliasConfig,
      service: {
        ...openAIAliasConfig.service,
        authentication: {
          type: 'APIKey',
          credentials: { apiKey: 'real-user-key' },
        },
      } as Config['service'],
    }

    const config = loadProjectJsonConfig(trustedIncoming) as Config

    expect((config.service as { baseURL?: string }).baseURL).toBeUndefined()
    expect((config.service as { endpoint?: string }).endpoint).toBeUndefined()
    expect((config.service as { fields?: unknown }).fields).toBeUndefined()
    if (config.service.authentication.type === 'APIKey') {
      expect(config.service.authentication.credentials.apiKey).toBe('real-user-key')
    } else {
      throw new Error('expected APIKey authentication to survive the merge')
    }

    expect(warn).toHaveBeenCalled()
    const warningMessage = warn.mock.calls.map((call) => call[0]).join('\n')
    expect(warningMessage).toContain('not trusted to control')
    expect(warningMessage).toContain('baseURL')
    expect(warningMessage).toContain('endpoint')
    expect(warningMessage).toContain('authentication')
    expect(warningMessage).toContain('fields')

    warn.mockRestore()
  })

  it('honors allowlisted tuning fields (model/temperature/provider) from a project file', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: {
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0.1,
        },
      })
    )

    const config = loadProjectJsonConfig(openAIAliasConfig) as Config

    expect(config.service.provider).toBe('openai')
    expect(config.service.model).toBe('gpt-4o')
    expect(config.service.temperature).toBe(0.1)
    // No untrusted keys were present, so no warning fires.
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  it('warns instead of throwing when the merged config fails validation', () => {
    // Reproduces the user-reported crash: the merged config has fields
    // the schema rejects (often inherited from a stale XDG / git
    // config layer), and the previous behavior threw, taking down
    // every coco command. The fix surfaces a warning so the user
    // can fix the offending field but keeps the merge so the rest
    // of the tool stays usable.
    mockFs.existsSync.mockReturnValue(true)
    // Project file has a valid local override (conventionalCommits)
    // but the merged result will inherit an invalid service shape
    // from the incoming `config` argument.
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ conventionalCommits: true })
    )

    const invalidIncoming = {
      service: {
        // Missing required fields + extra unknown field — guaranteed
        // to fail any anyOf branch in the service schema.
        provider: 'openai',
        model: 'gpt-4o',
        unknownDriftField: 'something',
      },
    } as unknown as Config

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => loadProjectJsonConfig(invalidIncoming)).not.toThrow()

    const result = loadProjectJsonConfig(invalidIncoming)
    // Local override still merged in despite validation failure —
    // the tool keeps working with the user's intent applied.
    expect((result as unknown as { conventionalCommits?: boolean }).conventionalCommits).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0][0]).toContain('config validation issues detected')

    warnSpy.mockRestore()
  })
})
