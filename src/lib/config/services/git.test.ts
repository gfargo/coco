import * as fs from 'fs'
import { Config } from '../types'
import { loadGitConfig } from './git'
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Config = {
  openAIApiKey: 'sk_default-api-key',
  
}

describe('loadGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load Git config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('[coco]\nopenAIApiKey=sk_git-config-api-key\ntokenLimit=250\n')
    const config = loadGitConfig(defaultConfig)
    expect(config.openAIApiKey).toBe('sk_git-config-api-key')
    expect(config.tokenLimit).toBe(250)
  })
})
