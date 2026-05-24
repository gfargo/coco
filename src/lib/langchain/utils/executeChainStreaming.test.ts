import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Logger } from '../../utils/logger'
import { getLlm } from './getLlm'
import {
  LangChainExecutionError,
  LangChainNetworkError,
} from '../errors'
import {
  executeChainStreaming,
  StreamingChunk,
} from './executeChainStreaming'

const prompt = PromptTemplate.fromTemplate('Answer this: {question}')
const variables = { question: 'noop' }

function silentLogger(): Logger {
  return new Logger({ silent: true })
}

function chunkRecorder(): {
  chunks: StreamingChunk[]
  onChunk: (chunk: StreamingChunk) => void
} {
  const chunks: StreamingChunk[] = []
  return {
    chunks,
    onChunk: (chunk) => {
      chunks.push(chunk)
    },
  }
}

/**
 * Production `executeChainStreaming` types `llm` as `ReturnType<typeof
 * getLlm>` — a narrow union of the concrete Chat* model classes coco
 * actually wires up. The `FakeListChatModel` we use here implements the
 * same `Runnable` surface area the helper exercises (`.pipe()`,
 * `.stream()`) but isn't a member of that union. The cast is purely a
 * type-system convenience for tests; the runtime behaviour is the same
 * polymorphic Runnable dispatch.
 */
function asLlm(model: FakeListChatModel): ReturnType<typeof getLlm> {
  return model as unknown as ReturnType<typeof getLlm>
}

describe('executeChainStreaming', () => {
  it('streams chunks for each token-ish fragment then returns the parsed final result', async () => {
    // FakeListChatModel.stream() emits the response one character at a
    // time, which is the closest stand-in for a real provider's
    // token-by-token output we can get without hitting a network.
    const llm = new FakeListChatModel({ responses: ['hello world'] })
    const { chunks, onChunk } = chunkRecorder()

    const result = await executeChainStreaming<string>({
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk,
      logger: silentLogger(),
    })

    // Every chunk should carry both the delta and the rolling
    // accumulation; surfaces pick whichever fits their rendering model.
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[chunks.length - 1].accumulated).toBe('hello world')
    // The parsed result is the StringOutputParser passing the
    // accumulated text through unchanged.
    expect(result).toBe('hello world')
  })

  it('hands each chunk the delta text AND the accumulation so far', async () => {
    const llm = new FakeListChatModel({ responses: ['abc'] })
    const { chunks, onChunk } = chunkRecorder()

    await executeChainStreaming<string>({
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk,
      logger: silentLogger(),
    })

    // Walk the chunks: each `accumulated` should equal the previous
    // `accumulated` plus the current `text`. Catches off-by-one
    // mistakes in the accumulator. Doesn't assert exact chunk count
    // because the FakeListChatModel may emit differently than a real
    // provider.
    let runningSum = ''
    for (const chunk of chunks) {
      runningSum += chunk.text
      expect(chunk.accumulated).toBe(runningSum)
    }
    expect(runningSum).toBe('abc')
  })

  it('swallows handler errors so a bad render handler cannot tank the LLM call', async () => {
    // A render handler that throws on every chunk used to mean the
    // user paid for the LLM call and got nothing back; the helper now
    // catches each callback error and keeps consuming the stream.
    const llm = new FakeListChatModel({ responses: ['hello'] })
    let invocations = 0
    const onChunk = () => {
      invocations += 1
      throw new Error('handler exploded')
    }

    const result = await executeChainStreaming<string>({
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk,
      logger: silentLogger(),
    })

    expect(invocations).toBeGreaterThan(0)
    // Despite the handler throwing, the call resolves with the
    // fully-accumulated parsed result.
    expect(result).toBe('hello')
  })

  it('throws LangChainExecutionError when the stream completes with no text chunks', async () => {
    // Empty-string response means the stream yields nothing renderable.
    // The helper refuses to invoke the parser on an empty string and
    // surfaces the failure explicitly so callers can distinguish
    // "model produced empty output" from "model produced unparseable
    // output."
    const llm = new FakeListChatModel({ responses: [''] })
    const { onChunk } = chunkRecorder()

    await expect(
      executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk,
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/Stream completed with no text chunks/)
  })

  it('rejects when required inputs are missing', async () => {
    const llm = new FakeListChatModel({ responses: ['x'] })
    const baseInput = {
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk: () => {
        /* noop */
      },
    } as const

    // `validateRequired` is shared with `executeChain`; spot-check that
    // the streaming variant wires it up the same way.
    await expect(
      executeChainStreaming<string>({ ...baseInput, llm: undefined as never }),
    ).rejects.toThrow(/llm/)
    await expect(
      executeChainStreaming<string>({ ...baseInput, onChunk: undefined as never }),
    ).rejects.toThrow(/onChunk/)
  })

  it('rejects when variables is not a plain object', async () => {
    const llm = new FakeListChatModel({ responses: ['x'] })
    await expect(
      executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt,
        variables: [] as unknown as Record<string, unknown>,
        parser: new StringOutputParser(),
        onChunk: () => {
          /* noop */
        },
        logger: silentLogger(),
      }),
    ).rejects.toThrow(LangChainExecutionError)
  })

  it('re-throws LangChain error subclasses unchanged (does not double-wrap)', async () => {
    // A parser that throws a LangChainExecutionError should surface
    // unchanged — callers may pattern-match on the error class.
    const llm = new FakeListChatModel({ responses: ['hello'] })
    const explodingParser = new StringOutputParser()
    jest.spyOn(explodingParser, 'invoke').mockImplementation(async () => {
      throw new LangChainExecutionError('parser blew up')
    })

    await expect(
      executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt,
        variables,
        parser: explodingParser,
        onChunk: () => {
          /* noop */
        },
        logger: silentLogger(),
      }),
    ).rejects.toThrow(LangChainExecutionError)
  })

  it('wraps network-style errors as LangChainNetworkError with provider + endpoint context', async () => {
    // Simulates a transport-layer failure during prompt rendering /
    // stream setup (DNS, ECONNREFUSED, etc.). The helper should
    // classify these the same way `executeChain` does so retry /
    // backoff logic upstream stays consistent across the streaming
    // and non-streaming paths.
    //
    // We trigger the failure at `prompt.format()` rather than at
    // `chain.stream()` because the latter routes through several
    // layers of LangChain internals (`RunnableSequence`,
    // `_streamResponseChunks`, etc.) that don't honor a top-level
    // `stream` spy. The classification logic in the catch block is
    // what we actually care about; any thrown network-shaped error
    // reaches it the same way.
    const llm = new FakeListChatModel({ responses: ['x'] })
    const failingPrompt = PromptTemplate.fromTemplate('Answer this: {question}')
    jest.spyOn(failingPrompt, 'format').mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    })

    await expect(
      executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt: failingPrompt,
        variables,
        parser: new StringOutputParser(),
        onChunk: () => {
          /* noop */
        },
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        logger: silentLogger(),
      }),
    ).rejects.toThrow(LangChainNetworkError)
  })
})
