import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Logger } from '../../utils/logger'
import { getLlm } from './getLlm'
import {
  LangChainCancelledError,
  LangChainExecutionError,
  LangChainNetworkError,
} from '../errors'
import {
  executeChainStreaming,
  StreamingChunk,
} from './executeChainStreaming'

/**
 * Stands in for a provider that streams structured output wrapped in
 * non-`.text` content parts (e.g. `{ type: 'json', json: {...} }`) instead
 * of plain text deltas. `FakeListChatModel` only ever emits string content,
 * so this hand-rolled model overrides `_streamResponseChunks` to yield
 * arbitrary content-array chunks and exercise `executeChainStreaming`'s
 * non-text fallback path (audit finding #2).
 */
class FakeNonTextChunkChatModel extends BaseChatModel {
  constructor(private readonly contentParts: unknown[]) {
    super({})
  }

  _llmType(): string {
    return 'fake-non-text-chunk'
  }

  async _generate(): Promise<ChatResult> {
    throw new Error('FakeNonTextChunkChatModel only supports streaming')
  }

  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    for (const part of this.contentParts) {
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({ content: [part] as never }),
        text: '',
      })
    }
  }
}

/**
 * Stands in for a provider that attaches `usage_metadata` to the final
 * streamed chunk only (the common case — see audit finding #4). Yields
 * plain-text chunks like a real provider, with `usage_metadata` set on the
 * last one so `executeChainStreaming` can exercise last-seen-value capture.
 */
class FakeUsageStreamChatModel extends BaseChatModel {
  constructor(
    private readonly textChunks: string[],
    private readonly usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  ) {
    super({})
  }

  _llmType(): string {
    return 'fake-usage-stream'
  }

  async _generate(): Promise<ChatResult> {
    throw new Error('FakeUsageStreamChatModel only supports streaming')
  }

  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    for (let i = 0; i < this.textChunks.length; i++) {
      const isLast = i === this.textChunks.length - 1
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: this.textChunks[i],
          usage_metadata: isLast ? this.usage : undefined,
        }),
        text: this.textChunks[i],
      })
    }
  }
}

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

  it('swallows transient handler errors (single failure) so the LLM call still resolves', async () => {
    // A render handler that throws intermittently shouldn't tank the
    // user's LLM call. The helper catches each callback error and
    // keeps consuming the stream as long as failures aren't
    // consecutive past the bail threshold (audit finding #13).
    const llm = new FakeListChatModel({ responses: ['hello'] })
    let invocations = 0
    const onChunk = () => {
      invocations += 1
      // Throw only on the first chunk — subsequent chunks succeed.
      if (invocations === 1) {
        throw new Error('transient handler blip')
      }
    }

    const result = await executeChainStreaming<string>({
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk,
      logger: silentLogger(),
    })

    expect(invocations).toBeGreaterThan(1)
    // Despite the first chunk's handler throwing, the call resolves
    // with the fully-accumulated parsed result.
    expect(result).toBe('hello')
  })

  it('bails the stream after 5 consecutive callback failures (audit finding #13)', async () => {
    // A genuinely broken render handler (one that throws on every
    // chunk) used to silently log to verbose for the entire LLM call,
    // wasting the user's wait. The bail threshold ensures the failure
    // surfaces as a thrown LangChainExecutionError after MAX_CALLBACK_FAILURES
    // consecutive throws.
    const llm = new FakeListChatModel({ responses: ['hello world this is a longer response'] })
    let invocations = 0
    const onChunk = () => {
      invocations += 1
      throw new Error('handler is completely broken')
    }

    await expect(
      executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk,
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/render handler failed 5 times in a row/)
    // Bail kicks in at the threshold so we don't burn through the
    // whole stream. The fake emits character-by-character; 5+ throws
    // happen well before the response ends.
    expect(invocations).toBeGreaterThanOrEqual(5)
  })

  it('resets the consecutive-failure counter on a successful callback (audit finding #13)', async () => {
    // The bail counts CONSECUTIVE failures. A handler that fails,
    // succeeds, fails again should not trigger the bail because the
    // failure streak got broken. Otherwise a flaky-but-mostly-working
    // handler would bail spuriously.
    const llm = new FakeListChatModel({ responses: ['abcdefghij'] })
    let invocations = 0
    const onChunk = () => {
      invocations += 1
      // Throw on odd invocations only; even ones succeed. Pattern
      // alternates so the streak never reaches 5.
      if (invocations % 2 === 1) {
        throw new Error('intermittent failure')
      }
    }

    const result = await executeChainStreaming<string>({
      llm: asLlm(llm),
      prompt,
      variables,
      parser: new StringOutputParser(),
      onChunk,
      logger: silentLogger(),
    })

    expect(result).toBe('abcdefghij')
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

  describe('non-text content-part fallback (audit finding #2)', () => {
    it('falls back to stringified content when the model streams JSON parts instead of text', async () => {
      const llm = new FakeNonTextChunkChatModel([
        { type: 'json', json: { title: 'fix(auth): handle expired tokens' } },
        { type: 'json', json: { body: 'Refresh before expiry.' } },
      ])
      const { chunks, onChunk } = chunkRecorder()

      const result = await executeChainStreaming<string>({
        llm: asLlm(llm as unknown as FakeListChatModel),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk,
        logger: silentLogger(),
      })

      // No `.text` parts arrived, so no incremental preview chunks fire —
      // only the final parse uses the stringified fallback.
      expect(chunks).toHaveLength(0)
      expect(result).toBe(
        '{"title":"fix(auth): handle expired tokens"}{"body":"Refresh before expiry."}'
      )
    })

    it('still throws "no text chunks" when the stream is genuinely empty', async () => {
      // Regression guard: the fallback must not mask a truly empty stream —
      // only chunks carrying SOME usable content should count.
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

    it('drops genuinely non-textual parts (e.g. images) rather than stringifying them', async () => {
      const llm = new FakeNonTextChunkChatModel([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      ])
      const { onChunk } = chunkRecorder()

      await expect(
        executeChainStreaming<string>({
          llm: asLlm(llm as unknown as FakeListChatModel),
          prompt,
          variables,
          parser: new StringOutputParser(),
          onChunk,
          logger: silentLogger(),
        }),
      ).rejects.toThrow(/Stream completed with no text chunks/)
    })

    it('prefers accumulated text over the non-text fallback when both are present', async () => {
      const llm = new FakeNonTextChunkChatModel([
        { type: 'text', text: 'hello' },
        { type: 'json', json: { ignored: true } },
      ])
      const { onChunk } = chunkRecorder()

      const result = await executeChainStreaming<string>({
        llm: asLlm(llm as unknown as FakeListChatModel),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk,
        logger: silentLogger(),
      })

      expect(result).toBe('hello')
    })
  })

  describe('completion-token capture (audit finding #4)', () => {
    it('captures usage_metadata from the last streamed chunk, not earlier ones', async () => {
      const llm = new FakeUsageStreamChatModel(['hello', ' world'], {
        input_tokens: 12,
        output_tokens: 34,
        total_tokens: 46,
      })
      const logger = { verbose: jest.fn() } as unknown as Logger
      const { onChunk } = chunkRecorder()

      const result = await executeChainStreaming<string>({
        llm: asLlm(llm as unknown as FakeListChatModel),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk,
        logger,
        metadata: { task: 'commit-message' },
      })

      expect(result).toBe('hello world')
      expect(logger.verbose).toHaveBeenCalledWith(
        expect.stringContaining('completionTokens=34'),
        { color: 'cyan' }
      )
    })
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

  describe('cancellation (#881 phase 3)', () => {
    it('throws LangChainCancelledError when the signal is already aborted before the call', async () => {
      // Pre-flight short-circuit: a caller that aborted before reaching
      // the helper shouldn't pay for prompt rendering or request setup.
      // The helper checks `signal.aborted` once at entry and bails out
      // with an empty accumulated buffer.
      const llm = new FakeListChatModel({ responses: ['hello'] })
      const controller = new AbortController()
      controller.abort()
      const { chunks, onChunk } = chunkRecorder()

      await expect(
        executeChainStreaming<string>({
          llm: asLlm(llm),
          prompt,
          variables,
          parser: new StringOutputParser(),
          onChunk,
          signal: controller.signal,
          logger: silentLogger(),
        }),
      ).rejects.toThrow(LangChainCancelledError)
      // No chunks delivered when the pre-flight check fires.
      expect(chunks).toHaveLength(0)
    })

    it('rejects with LangChainCancelledError when an in-flight stream is aborted', async () => {
      // Mid-stream abort: the fake model emits character-by-character,
      // we abort after the first chunk arrives, and the helper
      // classifies the resulting throw as cancellation rather than
      // network failure. The error carries the partial accumulated
      // text so callers can salvage if they want.
      const llm = new FakeListChatModel({ responses: ['hello world'], sleep: 5 })
      const controller = new AbortController()
      const { chunks, onChunk } = chunkRecorder()

      const promise = executeChainStreaming<string>({
        llm: asLlm(llm),
        prompt,
        variables,
        parser: new StringOutputParser(),
        onChunk: (chunk) => {
          onChunk(chunk)
          // Abort the moment the first chunk arrives so the next
          // iteration of the for-await sees a cancelled signal.
          if (chunks.length === 1) {
            controller.abort()
          }
        },
        signal: controller.signal,
        logger: silentLogger(),
      })

      await expect(promise).rejects.toThrow(LangChainCancelledError)
      // At least one chunk landed before we aborted, so the recorder
      // proves the stream was genuinely in flight, not pre-aborted.
      expect(chunks.length).toBeGreaterThan(0)
    })

    it('attaches the accumulated text to the LangChainCancelledError', async () => {
      // Salvageability check: the error carries the partial buffer so
      // a caller that wanted to preserve mid-cancel state could pull
      // it off the error. Today the workstation discards, but the
      // contract should survive that choice.
      const llm = new FakeListChatModel({ responses: ['abcdef'], sleep: 5 })
      const controller = new AbortController()
      let captured: LangChainCancelledError | undefined

      try {
        await executeChainStreaming<string>({
          llm: asLlm(llm),
          prompt,
          variables,
          parser: new StringOutputParser(),
          onChunk: ({ accumulated }) => {
            if (accumulated.length >= 2) {
              controller.abort()
            }
          },
          signal: controller.signal,
          logger: silentLogger(),
        })
      } catch (error) {
        if (error instanceof LangChainCancelledError) {
          captured = error
        }
      }

      expect(captured).toBeInstanceOf(LangChainCancelledError)
      // Accumulated text reflects what landed before the abort fired.
      // Don't assert exact contents — provider chunking can vary —
      // but the prefix should match the start of the response.
      expect(captured?.accumulated).toBeDefined()
      expect(captured?.accumulated?.length).toBeGreaterThan(0)
    })
  })
})
