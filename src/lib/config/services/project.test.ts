import * as fs from 'fs'
import { loadProjectJsonConfig } from './project'
import { Config } from '../types'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'

jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

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
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load project config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai', 'gpt-3.5-turbo') })
    )
    const config = loadProjectJsonConfig(openAIAliasConfig)
    expect(config.service.provider).toBe('openai')
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
