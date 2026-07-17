import * as fs from 'fs'
import { Config } from '../types'
import { loadGitignore, loadIgnore } from './ignore'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'

jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Config = {
  service: getDefaultServiceConfigFromAlias('openai'),
  mode: 'stdout',
  defaultBranch: 'main',
}

describe('loadGitignore', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load .gitignore', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('file.txt\n#comment\n')
    const config = loadGitignore(defaultConfig)
    expect(config.ignoredFiles).toContain('file.txt')
    expect(config.ignoredFiles).not.toContain('#comment')
  })

  it('should exclude negation patterns starting with !', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      'node_modules\n!stacks/*/logs/\n!stacks/*/logs/**/.gitkeep\n#comment\n'
    )
    const config = loadGitignore(defaultConfig)
    expect(config.ignoredFiles).toContain('node_modules')
    expect(config.ignoredFiles).not.toContain('!stacks/*/logs/')
    expect(config.ignoredFiles).not.toContain('!stacks/*/logs/**/.gitkeep')
  })

  it('does not mutate the config object passed in', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('file.txt\n')
    const input: Config = { ...defaultConfig }
    const result = loadGitignore(input)
    expect(input.ignoredFiles).toBeUndefined()
    expect(result).not.toBe(input)
  })
})

describe('loadIgnore', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load .ignore', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('ignore.txt\n#comment\n')
    const config = loadIgnore(defaultConfig)
    expect(config.ignoredFiles).toContain('ignore.txt')
    expect(config.ignoredFiles).not.toContain('#comment')
  })

  it('should exclude negation patterns starting with !', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('dist\n!dist/keep.js\n#comment\n')
    const config = loadIgnore(defaultConfig)
    expect(config.ignoredFiles).toContain('dist')
    expect(config.ignoredFiles).not.toContain('!dist/keep.js')
  })

  it('does not mutate the config object passed in', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('ignore.txt\n')
    const input: Config = { ...defaultConfig }
    const result = loadIgnore(input)
    expect(input.ignoredFiles).toBeUndefined()
    expect(result).not.toBe(input)
  })
})
