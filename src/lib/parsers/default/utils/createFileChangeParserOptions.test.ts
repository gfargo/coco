import { createFileChangeParserOptions } from './createFileChangeParserOptions'
import { Logger } from '../../../utils/logger'

describe('createFileChangeParserOptions', () => {
  it('builds parser options with budget fields and telemetry metadata', () => {
    const tokenizer = jest.fn()
    const git = {} as never
    const llm = {} as never
    const logger = {} as Logger

    const result = createFileChangeParserOptions({
      command: 'review',
      git,
      llm,
      logger,
      model: 'gpt-4o-mini',
      provider: 'openai',
      service: {
        tokenLimit: 4096,
        minTokensForSummary: 400,
        maxFileTokens: 1200,
        maxConcurrent: 2,
      },
      tokenizer,
    })

    expect(result).toEqual({
      tokenizer,
      git,
      llm,
      logger,
      maxTokens: 4096,
      minTokensForSummary: 400,
      maxFileTokens: 1200,
      maxConcurrent: 2,
      metadata: {
        command: 'review',
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    })
  })

  it('allows commands without explicit budget overrides', () => {
    const result = createFileChangeParserOptions({
      command: 'recap',
      git: {} as never,
      llm: {} as never,
      logger: {} as Logger,
      model: 'gpt-4o',
      provider: 'openai',
      tokenizer: jest.fn(),
    })

    expect(result).toEqual(expect.objectContaining({
      maxTokens: undefined,
      minTokensForSummary: undefined,
      maxFileTokens: undefined,
      maxConcurrent: undefined,
      metadata: {
        command: 'recap',
        provider: 'openai',
        model: 'gpt-4o',
      },
    }))
  })
})
