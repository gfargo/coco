import { Config } from '../types'
import { loadEnvConfig } from './env'

const defaultConfig: Config = {
  service: 'ollama',
  endpoint: '',
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadEnvConfig', () => {
  it('should load environment variables', () => {
    process.env.COCO_SERVICE = 'openai'
    process.env.COCO_DEFAULT_BRANCH = 'coco'
    const config = loadEnvConfig(defaultConfig)
    expect(config.service).toBe('openai')
    expect(config.defaultBranch).toBe('coco')
    delete process.env.COCO_SERVICE
    delete process.env.COCO_DEFAULT_BRANCH
  })

  it('should load environment variables with mode', () => {
    process.env.COCO_MODE = 'interactive'
    const config = loadEnvConfig(defaultConfig)
    expect(config.mode).toBe('interactive')
    delete process.env.COCO_MODE
  })

  it('should load environment variables with verbose', () => {
    process.env.COCO_VERBOSE = 'true'
    const config = loadEnvConfig(defaultConfig)
    expect(config.verbose).toBe(true)
    delete process.env.COCO_VERBOSE
  })

  it('should load environment variables with ignoredFiles', () => {
    process.env.COCO_IGNORED_FILES = 'package-lock.json,node_modules'
    const config = loadEnvConfig(defaultConfig)
    expect(config.ignoredFiles).toEqual(['package-lock.json', 'node_modules'])
    delete process.env.COCO_IGNORED_FILES
  })

  it('should load environment variables with ignoredExtensions', () => {
    process.env.COCO_IGNORED_EXTENSIONS = '.map,.lock'
    const config = loadEnvConfig(defaultConfig)
    expect(config.ignoredExtensions).toEqual(['.map', '.lock'])
    delete process.env.COCO_IGNORED_EXTENSIONS
  })

  it('should load environment variables with prompt', () => {
    process.env.COCO_PROMPT = 'prompt'
    const config = loadEnvConfig(defaultConfig)
    expect(config.prompt).toEqual('prompt')
    delete process.env.COCO_PROMPT
  })
})
