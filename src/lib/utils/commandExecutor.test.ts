import commandExecutor, { extractMissingOllamaModel } from './commandExecutor'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'

jest.mock('../config/utils/loadConfig')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>

describe('commandExecutor — global --quiet wiring', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    mockLoadConfig.mockReturnValue({ verbose: false } as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('silences logger.log output when --quiet is set', async () => {
    const handler: CommandHandler<never> = async (_argv, logger: Logger) => {
      logger.log('status line')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('leaves logger.log output intact without --quiet', async () => {
    const handler: CommandHandler<never> = async (_argv, logger: Logger) => {
      logger.log('status line')
    }
    await commandExecutor(handler)({ quiet: false } as never)
    expect(logSpy).toHaveBeenCalled()
  })
})

describe('extractMissingOllamaModel', () => {
  it('extracts the model from Ollama\'s not-found message (quoted)', () => {
    const err = new Error('model "qwen2.5-coder:14b" not found, try pulling it first')
    expect(extractMissingOllamaModel(err)).toBe('qwen2.5-coder:14b')
  })

  it('extracts the model when unquoted', () => {
    const err = new Error('model llama3.1:8b not found, try pulling it first')
    expect(extractMissingOllamaModel(err)).toBe('llama3.1:8b')
  })

  it('sees through a wrapped/prefixed message', () => {
    const err = new Error('commit: model "phi3:mini" not found, try pulling it first')
    expect(extractMissingOllamaModel(err)).toBe('phi3:mini')
  })

  it('ignores non-Ollama "model not found" errors (no pull hint)', () => {
    // OpenAI-style — must not get mis-advised toward `ollama pull`
    const err = new Error('The model `gpt-5` does not exist or you do not have access.')
    expect(extractMissingOllamaModel(err)).toBeNull()
  })

  it('returns null for unrelated errors and non-Errors', () => {
    expect(extractMissingOllamaModel(new Error('ECONNREFUSED'))).toBeNull()
    expect(extractMissingOllamaModel('not an error')).toBeNull()
    expect(extractMissingOllamaModel(undefined)).toBeNull()
  })
})
