import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage } from '@langchain/core/messages'
import type { ChatResult } from '@langchain/core/outputs'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableLambda } from '@langchain/core/runnables'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { z } from 'zod'
import { Logger } from '../../utils/logger'
import { getLlm } from './getLlm'
import { recordLlmMetadata } from './llmMetadata'
import { executeChainWithSchema } from './executeChainWithSchema'

/**
 * Stands in for a provider whose chat model natively supports
 * `withStructuredOutput` (openai/azure/gemini/mistral/ollama). Records every
 * call so tests can assert the schema + method it was invoked with, and
 * lets the returned structured runnable be made to throw on demand to
 * exercise the fallback path.
 */
class FakeStructuredChatModel extends BaseChatModel {
  constructor(
    private readonly rawText: string
  ) {
    super({})
  }

  _llmType(): string {
    return 'fake-structured'
  }

  async _generate(): Promise<ChatResult> {
    const message = new AIMessage({ content: this.rawText })
    return { generations: [{ message, text: this.rawText }] }
  }
}

/**
 * `withStructuredOutput`'s real signature constrains its return type to a
 * `{ raw, parsed }`-shaped runnable when `includeRaw` is set, which a plain
 * class override can't satisfy for an arbitrary fake result — so the fake
 * is patched on as an untyped instance property instead of overridden in
 * the class body.
 */
function withFakeStructuredOutput(
  model: FakeStructuredChatModel,
  structuredResult: unknown,
  failStructured = false
): Array<{ schema: unknown; config: unknown }> {
  const calls: Array<{ schema: unknown; config: unknown }> = []
  ;(model as unknown as { withStructuredOutput: unknown }).withStructuredOutput = (
    schema: unknown,
    config?: unknown
  ) => {
    calls.push({ schema, config })
    return RunnableLambda.from(async () => {
      if (failStructured) {
        throw new Error('provider rejected native structured output')
      }
      return structuredResult
    })
  }
  return calls
}

const schema = z.object({ foo: z.string() })
const prompt = PromptTemplate.fromTemplate('Answer this: {question}')
const variables = { question: 'noop' }

function silentLogger(): Logger {
  return new Logger({ silent: true })
}

/** See executeChain.test.ts for why this cast exists. */
function asLlm(model: BaseChatModel): Awaited<ReturnType<typeof getLlm>> {
  return model as unknown as Awaited<ReturnType<typeof getLlm>>
}

describe('executeChainWithSchema', () => {
  it('binds the schema via withStructuredOutput when the provider advertises json-schema support', async () => {
    const model = new FakeStructuredChatModel('unused')
    const calls = withFakeStructuredOutput(model, { foo: 'bar' })
    recordLlmMetadata(model, { provider: 'openai' })

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual({ foo: 'bar' })
    expect(calls).toHaveLength(1)
    expect(calls[0].config).toEqual({ method: 'jsonSchema' })
  })

  it('binds the schema via withStructuredOutput with jsonMode for a json-mode provider (ollama)', async () => {
    const model = new FakeStructuredChatModel('unused')
    const calls = withFakeStructuredOutput(model, { foo: 'bar' })
    recordLlmMetadata(model, { provider: 'ollama' })

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual({ foo: 'bar' })
    expect(calls[0].config).toEqual({ method: 'jsonMode' })
  })

  it('falls back to the text StructuredOutputParser when the provider has no native support', async () => {
    const model = new FakeListChatModel({ responses: ['{"foo":"bar"}'] })
    recordLlmMetadata(model, { provider: 'anthropic' })
    const spy = jest.spyOn(model, 'withStructuredOutput')

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual({ foo: 'bar' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to the text StructuredOutputParser when no provider metadata was recorded', async () => {
    const model = new FakeListChatModel({ responses: ['{"foo":"bar"}'] })
    const spy = jest.spyOn(model, 'withStructuredOutput')

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual({ foo: 'bar' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('still uses the fallbackParser (against the original llm) when native structured output fails', async () => {
    const model = new FakeStructuredChatModel('fallback raw text')
    withFakeStructuredOutput(model, { foo: 'bar' }, true)
    recordLlmMetadata(model, { provider: 'openai' })
    const onFallback = jest.fn()
    const fallbackParser = jest.fn((text: string) => ({ foo: `parsed:${text}` }))

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
      retryOptions: { maxAttempts: 1 },
      onFallback,
      fallbackParser,
    })

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(fallbackParser).toHaveBeenCalledWith('fallback raw text')
    expect(result).toEqual({ foo: 'parsed:fallback raw text' })
  })

  it('never binds withStructuredOutput for an array-root schema, even on a json-schema provider', async () => {
    const arraySchema = z.array(z.object({ foo: z.string() }))
    const model = new FakeListChatModel({ responses: ['[{"foo":"bar"}]'] })
    recordLlmMetadata(model, { provider: 'openai' })
    const spy = jest.spyOn(model, 'withStructuredOutput')

    const result = await executeChainWithSchema(arraySchema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual([{ foo: 'bar' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('never binds withStructuredOutput for a z.preprocess-wrapped array schema (the review feedback shape)', async () => {
    const preprocessedArraySchema = z.preprocess(
      (value) => (Array.isArray(value) ? value : [value]),
      z.array(z.object({ foo: z.string() }))
    )
    const model = new FakeListChatModel({ responses: ['{"foo":"bar"}'] })
    recordLlmMetadata(model, { provider: 'openai' })
    const spy = jest.spyOn(model, 'withStructuredOutput')

    const result = await executeChainWithSchema(preprocessedArraySchema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
    })

    expect(result).toEqual([{ foo: 'bar' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('degrades to the legacy text parser when native structured output fails and no fallbackParser was supplied', async () => {
    const model = new FakeStructuredChatModel('{"foo":"bar"}')
    withFakeStructuredOutput(model, { foo: 'bar' }, true)
    recordLlmMetadata(model, { provider: 'openai' })

    const result = await executeChainWithSchema(schema, asLlm(model), prompt, variables, {
      logger: silentLogger(),
      retryOptions: { maxAttempts: 1 },
    })

    expect(result).toEqual({ foo: 'bar' })
  })
})
