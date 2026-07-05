import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage } from '@langchain/core/messages'
import { OutputParserException, StringOutputParser } from '@langchain/core/output_parsers'
import type { ChatResult } from '@langchain/core/outputs'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableLambda } from '@langchain/core/runnables'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Logger } from '../../utils/logger'
import { getLlm } from './getLlm'
import { LangChainExecutionError, LangChainSchemaParseError } from '../errors'
import { executeChain } from './executeChain'

/**
 * Stands in for a provider that reports token usage on the completed
 * chat-model run. `FakeListChatModel` never populates `usage_metadata`, so
 * this hand-rolled model does, to exercise `executeChain`'s
 * `handleLLMEnd`-based completion-token capture (audit finding #4).
 */
class FakeUsageChatModel extends BaseChatModel {
  constructor(
    private readonly responseText: string,
    private readonly usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
  ) {
    super({})
  }

  _llmType(): string {
    return 'fake-usage'
  }

  async _generate(): Promise<ChatResult> {
    const message = new AIMessage({ content: this.responseText, usage_metadata: this.usage })
    return { generations: [{ message, text: this.responseText }] }
  }
}

const prompt = PromptTemplate.fromTemplate('Answer this: {question}')
const variables = { question: 'noop' }

function silentLogger(): Logger {
  return new Logger({ silent: true })
}

/**
 * See executeChainStreaming.test.ts for why this cast exists: FakeListChatModel
 * implements the same Runnable surface the helper exercises but isn't a
 * member of the narrow `ReturnType<typeof getLlm>` union.
 */
function asLlm(model: FakeListChatModel): ReturnType<typeof getLlm> {
  return model as unknown as ReturnType<typeof getLlm>
}

describe('executeChain', () => {
  it('wraps an OutputParserException as LangChainSchemaParseError, not a generic execution error', async () => {
    const llm = new FakeListChatModel({ responses: ['not valid json'] })
    const parser = RunnableLambda.from(() => {
      throw new OutputParserException('Failed to parse. Text: "not valid json"')
    })

    await expect(
      executeChain({
        llm: asLlm(llm),
        prompt,
        variables,
        parser,
        logger: silentLogger(),
      })
    ).rejects.toBeInstanceOf(LangChainSchemaParseError)
  })

  it('still wraps other thrown errors as a plain LangChainExecutionError', async () => {
    const llm = new FakeListChatModel({ responses: ['whatever'] })
    const parser = RunnableLambda.from(() => {
      throw new Error('boom')
    })

    const failure = executeChain({
      llm: asLlm(llm),
      prompt,
      variables,
      parser,
      logger: silentLogger(),
    })

    await expect(failure).rejects.toBeInstanceOf(LangChainExecutionError)
    await expect(failure).rejects.not.toBeInstanceOf(LangChainSchemaParseError)
  })

  describe('completion-token capture (audit finding #4)', () => {
    it('captures output_tokens from usage_metadata and logs it alongside prompt tokens', async () => {
      const llm = new FakeUsageChatModel('hello world', {
        input_tokens: 12,
        output_tokens: 34,
        total_tokens: 46,
      })
      const logger = { verbose: jest.fn() } as unknown as Logger

      const result = await executeChain<string>({
        llm: asLlm(llm as unknown as FakeListChatModel),
        prompt,
        variables,
        parser: new StringOutputParser(),
        logger,
        metadata: { task: 'commit-message' },
      })

      expect(result).toBe('hello world')
      expect(logger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('completionTokens=34'),
        { color: 'cyan' }
      )
    })

    it('leaves completionTokens undefined (not 0) when the provider reports no usage metadata', async () => {
      const llm = new FakeListChatModel({ responses: ['no usage here'] })
      const logger = { verbose: jest.fn() } as unknown as Logger

      await executeChain<string>({
        llm: asLlm(llm),
        prompt,
        variables,
        parser: new StringOutputParser(),
        logger,
        metadata: { task: 'commit-message' },
      })

      const verboseCalls = (logger.verbose as jest.Mock).mock.calls.map((call) => call[0] as string)
      expect(verboseCalls.some((line) => line.includes('completionTokens'))).toBe(false)
    })
  })
})
