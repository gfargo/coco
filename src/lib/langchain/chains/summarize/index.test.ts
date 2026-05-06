import { Document } from '@langchain/classic/document'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

import { summarize, SummarizeContext } from './index'

/**
 * The summarize() helper wraps the chain.invoke() call in a
 * 429-aware adaptive backoff (#845, PR 3). These tests pin the
 * retry behavior so a future regression in the chain wrapper
 * doesn't silently start failing user pipelines on transient rate
 * limits.
 */

function makeContext(overrides: { invoke: jest.Mock }): SummarizeContext {
  const chain = { invoke: overrides.invoke } as unknown as SummarizeContext['chain']
  return {
    chain,
    textSplitter: new RecursiveCharacterTextSplitter({ chunkSize: 100, chunkOverlap: 0 }),
  }
}

describe('summarize() retry behavior', () => {
  beforeAll(() => {
    // Speed up tests by faking the backoff timer.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('returns the chain output on success without retrying', async () => {
    const invoke = jest.fn().mockResolvedValue({ text: 'summary' })
    const ctx = makeContext({ invoke })
    const result = await summarize([{ pageContent: 'hello world' }], ctx)
    expect(result).toBe('summary')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['429', { status: 429 }],
    ['rate_limit_exceeded code', { code: 'rate_limit_exceeded' }],
    ['ECONNRESET', { code: 'ECONNRESET' }],
    ['429 in message', new Error('OpenAI returned 429: Too Many Requests')],
    ['rate-limit in message', new Error('Anthropic rate-limit exceeded, retry later')],
    ['503', { status: 503 }],
  ])('retries on retryable %s and eventually succeeds', async (_, errorShape) => {
    const error = errorShape instanceof Error ? errorShape : Object.assign(new Error('boom'), errorShape)
    const invoke = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ text: 'late summary' })
    const ctx = makeContext({ invoke })
    const promise = summarize([{ pageContent: 'hello' }], ctx)
    // Drain the backoff timer.
    await jest.runOnlyPendingTimersAsync()
    await expect(promise).resolves.toBe('late summary')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on non-retryable errors', async () => {
    const invoke = jest.fn().mockRejectedValue(Object.assign(new Error('Bad Request'), { status: 400 }))
    const ctx = makeContext({ invoke })
    await expect(summarize([{ pageContent: 'hello' }], ctx)).rejects.toThrow('Bad Request')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('gives up after BACKOFF_RETRIES (3) attempts on persistent rate limits', async () => {
    const error = Object.assign(new Error('429'), { status: 429 })
    const invoke = jest.fn().mockImplementation(() => Promise.reject(error))
    const ctx = makeContext({ invoke })
    const promise = summarize([{ pageContent: 'hello' }], ctx)
    // Pre-attach a rejection handler so node's unhandled-rejection
    // tracking doesn't fire before we drain the backoff timers.
    promise.catch(() => undefined)
    await jest.runAllTimersAsync()
    await expect(promise).rejects.toThrow('429')
    // Initial attempt + 3 retries = 4 total invocations.
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it('passes the chain Document[] shape unchanged through retries', async () => {
    const invoke = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
      .mockResolvedValue({ text: 'ok' })
    const ctx = makeContext({ invoke })
    const promise = summarize([{ pageContent: 'first doc' }], ctx)
    await jest.runOnlyPendingTimersAsync()
    await promise
    // Both calls should have received the same input shape.
    const [firstCall, secondCall] = invoke.mock.calls
    expect(firstCall[0].input_documents).toEqual(secondCall[0].input_documents)
    expect(firstCall[0].input_documents[0]).toBeInstanceOf(Document)
  })
})
