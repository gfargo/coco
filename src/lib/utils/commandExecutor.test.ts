import commandExecutor, { extractMissingOllamaModel, isPromptCancellation } from './commandExecutor'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'
import { LangChainAuthenticationError, LangChainNetworkError } from '../langchain/errors'
import { handleLangChainError } from '../langchain/errorHandler'

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
    // No spurious stderr output for a successful run
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('leaves logger.log output intact without --quiet', async () => {
    const handler: CommandHandler<never> = async (_argv, logger: Logger) => {
      logger.log('status line')
    }
    await commandExecutor(handler)({ quiet: false } as never)
    expect(logSpy).toHaveBeenCalled()
  })

  it('emits auth error to stderr even when --quiet is set', async () => {
    const handler: CommandHandler<never> = async () => {
      throw new LangChainAuthenticationError('bad key', 'openai')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    expect(stderrSpy).toHaveBeenCalled()
    // The auth error must not leak to stdout
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  // Regression (#1637): a real provider 401 (invalid/revoked key) used to
  // surface as a generic execution error — the curated authentication
  // troubleshooting block only ever fired for a locally-missing key. This
  // exercises the full pipeline: a raw provider-shaped error classified by
  // handleLangChainError, then rendered by commandExecutor's formatter.
  it('renders the authentication formatter for a raw provider 401, not the generic one', async () => {
    const handler: CommandHandler<never> = async () => {
      handleLangChainError(
        { status: 401, message: 'Incorrect API key provided' },
        'executeChain: Chain execution failed',
        { provider: 'openai', endpoint: 'https://api.openai.com' }
      )
    }
    await commandExecutor(handler)({ quiet: true } as never)

    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join('')
    expect(written).toContain('Authentication failed')
    expect(written).toContain('OPENAI_API_KEY')
    // The generic formatter prints the raw error message unconditionally;
    // the auth formatter only does under --verbose (off here) — its
    // absence confirms the curated path rendered, not the generic one.
    expect(written).not.toContain('Incorrect API key provided')
    expect(process.exitCode).toBe(1)
  })

  // Providers reuse HTTP 429 for `insufficient_quota` (billing exhausted).
  // This exercises the full pipeline: a raw provider-shaped quota error
  // classified by handleLangChainError, then rendered with billing-oriented
  // guidance instead of the rate-limit "wait and retry" remedy.
  it('renders billing guidance (not the rate-limit remedy) for an insufficient_quota 429', async () => {
    const handler: CommandHandler<never> = async () => {
      handleLangChainError(
        {
          status: 429,
          code: 'insufficient_quota',
          message: 'You exceeded your current quota, please check your plan and billing details.',
        },
        'executeChain: Chain execution failed',
        { provider: 'openai' }
      )
    }
    await commandExecutor(handler)({ quiet: true } as never)

    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join('')
    expect(written).toContain('quota exhausted (billing)')
    expect(written).toContain('credit balance')
    expect(written).toContain('budget caps')
    // The provider's own message renders without --verbose
    expect(written).toContain('You exceeded your current quota')
    // The rate-limit remedy must not render — retrying can't fix billing
    expect(written).not.toContain('Wait a bit and retry')
    expect(written).not.toContain('service.maxConcurrent')
    expect(process.exitCode).toBe(1)
  })

  it('includes the provider message in rate-limit output without --verbose', async () => {
    const handler: CommandHandler<never> = async () => {
      handleLangChainError(
        { status: 429, message: 'Rate limit reached for gpt-4o: try again in 20s' },
        'executeChain: Chain execution failed',
        { provider: 'openai' }
      )
    }
    await commandExecutor(handler)({ quiet: true } as never)

    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join('')
    expect(written).toContain('Rate limited by openai')
    expect(written).toContain('Rate limit reached for gpt-4o: try again in 20s')
    expect(written).toContain('Wait a bit and retry')
    expect(process.exitCode).toBe(1)
  })

  it('emits network error to stderr even when --quiet is set', async () => {
    const handler: CommandHandler<never> = async () => {
      throw new LangChainNetworkError('connection refused', 'https://api.openai.com', 'openai')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    expect(stderrSpy).toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('emits generic error to stderr even when --quiet is set', async () => {
    const handler: CommandHandler<never> = async () => {
      throw new Error('downstream failure')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    expect(stderrSpy).toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('emits error to stderr when logger was silenced via quiet:true in handler (non-interactive mode)', async () => {
    const handler: CommandHandler<never> = async (_argv, logger) => {
      // This is what commit/handler.ts and recap/handler.ts do in non-interactive mode
      logger.setConfig({ quiet: true })
      throw new Error('downstream failure after silencing')
    }
    await commandExecutor(handler)({} as never)
    expect(stderrSpy).toHaveBeenCalled()
    // Must not appear on stdout
    expect(logSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
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
