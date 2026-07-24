import { Logger } from '../../utils/logger'
import {
    estimatePromptTokens,
    logLlmCall,
    logLlmTelemetrySummary,
    resetLlmTelemetry,
} from './observability'

describe('LLM observability utilities', () => {
  afterEach(() => {
    resetLlmTelemetry()
  })

  it('estimates prompt tokens with the configured tokenizer', () => {
    expect(estimatePromptTokens((text) => text.split(/\s+/).length, 'one two three')).toBe(3)
  })

  it('logs structured metadata without prompt content', () => {
    const logger = {
      verbose: jest.fn(),
    } as unknown as Logger

    logLlmCall(logger, {
      task: 'commit-message',
      command: 'commit',
      surface: 'agent-cli',
      provider: 'openai',
      model: 'gpt-4o',
      retryAttempt: 2,
      promptTokens: 123,
      variableKeys: ['summary', 'format_instructions'],
    })

    expect(logger.verbose).toHaveBeenCalledWith(
      '[llm] task=commit-message command=commit surface=agent-cli provider=openai model=gpt-4o retryAttempt=2 promptTokens=123 variableKeys=summary,format_instructions',
      { color: 'cyan' }
    )
  })

  it('does not log when a logger is not provided', () => {
    expect(() => logLlmCall(undefined, { task: 'summarize' })).not.toThrow()
  })

  it('logs and resets per-command telemetry summaries', () => {
    const logger = {
      verbose: jest.fn(),
    } as unknown as Logger

    logLlmCall(logger, {
      task: 'summarize-large-file',
      command: 'commit',
      model: 'gpt-4.1-nano',
      promptTokens: 100,
      elapsedMs: 25,
      inputDocuments: 1,
      inputChunks: 3,
    })
    logLlmCall(logger, {
      task: 'commit-message',
      command: 'commit',
      model: 'gpt-4.1-mini',
      promptTokens: 50,
      elapsedMs: 10,
    })

    const summary = logLlmTelemetrySummary(logger, 'commit')

    expect(summary).toBe('[llm:summary] command=commit calls=2 promptTokens=150 elapsedMs=35 inputDocuments=1 inputChunks=3 tasks=summarize-large-file,commit-message models=gpt-4.1-nano,gpt-4.1-mini')
    expect(logger.verbose).toHaveBeenCalledWith(
      '[llm:summary] command=commit calls=2 promptTokens=150 elapsedMs=35 inputDocuments=1 inputChunks=3 tasks=summarize-large-file,commit-message models=gpt-4.1-nano,gpt-4.1-mini',
      { color: 'cyan' }
    )
    expect(logger.verbose).toHaveBeenCalledTimes(3)
  })
})
