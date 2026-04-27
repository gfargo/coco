import { Logger } from '../../utils/logger'
import { estimatePromptTokens, logLlmCall } from './observability'

describe('LLM observability utilities', () => {
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
      provider: 'openai',
      model: 'gpt-4o',
      retryAttempt: 2,
      promptTokens: 123,
      variableKeys: ['summary', 'format_instructions'],
    })

    expect(logger.verbose).toHaveBeenCalledWith(
      '[llm] task=commit-message command=commit provider=openai model=gpt-4o retryAttempt=2 promptTokens=123 variableKeys=summary,format_instructions',
      { color: 'cyan' }
    )
  })

  it('does not log when a logger is not provided', () => {
    expect(() => logLlmCall(undefined, { task: 'summarize' })).not.toThrow()
  })
})
