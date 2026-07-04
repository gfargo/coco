import commandExecutor, { extractMissingOllamaModel, isPromptCancellation } from './commandExecutor'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'

jest.mock('../config/utils/loadConfig')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>

describe('commandExecutor — global --quiet wiring', () => {
  let logSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance

  beforeEach(() => {
    mockLoadConfig.mockReturnValue({ verbose: false } as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    logSpy.mockRestore()
    stderrSpy.mockRestore()
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

  it('routes error messages to stderr, not stdout', async () => {
    const handler: CommandHandler<never> = async () => {
      throw new Error('boom')
    }
    await commandExecutor(handler)({ quiet: false } as never)
    // The generic error formatter writes to stderr via logger.error
    expect(stderrSpy).toHaveBeenCalled()
    // Nothing about the error should leak to stdout
    const stdoutCalls = (logSpy.mock.calls as string[][]).flat().join(' ')
    expect(stdoutCalls).not.toMatch(/Failed to execute/)
    expect(stdoutCalls).not.toMatch(/boom/)
  })

  it('silences logger.error output when --quiet is set', async () => {
    const handler: CommandHandler<never> = async () => {
      throw new Error('quiet error')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    // With --quiet (silent: true) error output is also suppressed
    expect(stderrSpy).not.toHaveBeenCalled()
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

describe('isPromptCancellation', () => {
  it('detects @inquirer/prompts ExitPromptError by name', () => {
    const err = new Error('User force closed the prompt with 0 null')
    err.name = 'ExitPromptError'
    expect(isPromptCancellation(err)).toBe(true)
  })

  it('detects the cancel via the message even if the name drifts', () => {
    expect(isPromptCancellation(new Error('User force closed the prompt with SIGINT'))).toBe(true)
  })

  it('is false for ordinary errors and non-Errors', () => {
    expect(isPromptCancellation(new Error('Something else failed'))).toBe(false)
    expect(isPromptCancellation('force closed the prompt')).toBe(false)
    expect(isPromptCancellation(undefined)).toBe(false)
  })
})
