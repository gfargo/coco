import * as fs from 'fs'
import { Config } from '../types'
import { loadXDGConfig } from './xdg'

jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Config = {
  openAIApiKey: 'sk_default-api-key',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadXDGConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load XDG config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ openAIApiKey: '1234' }))
    const config = loadXDGConfig(defaultConfig)
    expect(config.openAIApiKey).toBe('1234')
  })
})
