import { Config } from '../types'
import { loadEnvConfig } from './env'

const defaultConfig: Config = {
  openAIApiKey: 'sk_test_1234',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadEnvConfig', () => {
  it('should load environment variables', () => {
    process.env.OPENAI_API_KEY = 'sk_env-api-key'
    process.env.COCO_TOKEN_LIMIT = '250'
    const config = loadEnvConfig(defaultConfig)
    expect(config.openAIApiKey).toBe('sk_env-api-key')
    expect(config.tokenLimit).toBe(250)
    delete process.env.OPENAI_API_KEY
    delete process.env.COCO_TOKEN_LIMIT
  })
})
