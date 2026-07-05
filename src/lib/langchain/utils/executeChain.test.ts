import { OutputParserException } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableLambda } from '@langchain/core/runnables'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Logger } from '../../utils/logger'
import { getLlm } from './getLlm'
import { LangChainExecutionError, LangChainSchemaParseError } from '../errors'
import { executeChain } from './executeChain'

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
})
