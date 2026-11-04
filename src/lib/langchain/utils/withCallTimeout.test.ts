import { LangChainTimeoutError } from '../errors'
import { isRetryableError } from '../errorHandler'
import { DEFAULT_CALL_TIMEOUT_MS, resolveCallTimeoutMs, withCallTimeout } from './withCallTimeout'

describe('resolveCallTimeoutMs', () => {
  it('prefers an explicit requestOptions.timeout for every provider', () => {
    expect(resolveCallTimeoutMs({ provider: 'openai', configured: 5000 })).toBe(5000)
    expect(resolveCallTimeoutMs({ provider: 'ollama', configured: 5000 })).toBe(5000)
  })

  it('defaults hosted providers to the generous ceiling', () => {
    for (const provider of ['openai', 'anthropic', 'google', 'bedrock', 'azure', undefined]) {
      expect(resolveCallTimeoutMs({ provider })).toBe(DEFAULT_CALL_TIMEOUT_MS)
    }
  })

  it('applies no default to Ollama', () => {
    expect(resolveCallTimeoutMs({ provider: 'ollama' })).toBeUndefined()
  })

  it('ignores a non-positive or non-finite configured value', () => {
    expect(resolveCallTimeoutMs({ provider: 'openai', configured: 0 })).toBe(DEFAULT_CALL_TIMEOUT_MS)
    expect(resolveCallTimeoutMs({ provider: 'openai', configured: NaN })).toBe(DEFAULT_CALL_TIMEOUT_MS)
  })
})

describe('withCallTimeout', () => {
  /** An invoke that never resolves but honors the abort signal, like a real HTTP call. */
  const stalledInvoke = () =>
    jest.fn(
      (_input: unknown, config?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener('abort', () => reject(config.signal?.reason ?? new Error('aborted')))
        })
    )

  it('returns the chain untouched when there is no timeout', () => {
    const chain = { invoke: jest.fn() }
    expect(withCallTimeout(chain, undefined)).toBe(chain)
  })

  it('passes a result through when the call finishes in time', async () => {
    const invoke = jest.fn().mockResolvedValue({ text: 'ok' })
    const wrapped = withCallTimeout({ invoke }, 1000)
    await expect(wrapped.invoke({ a: 1 } as never)).resolves.toEqual({ text: 'ok' })
    // The signal rides in the input values too: classic BaseChain only watches `values.signal`.
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ a: 1, signal: expect.any(AbortSignal) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('turns a stalled call into a retryable LangChainTimeoutError', async () => {
    const wrapped = withCallTimeout({ invoke: stalledInvoke() }, 20)
    const error = await wrapped.invoke({} as never).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LangChainTimeoutError)
    expect((error as Error).message).toMatch(/timed out after 20ms/)
    expect(isRetryableError(error)).toBe(true)
  })

  it('gives every invoke a fresh signal, so a retry gets a full budget', async () => {
    const signals: AbortSignal[] = []
    const invoke = jest.fn(async (_input: unknown, config?: { signal?: AbortSignal }) => {
      signals.push(config!.signal!)
      return { text: 'ok' }
    })
    const wrapped = withCallTimeout({ invoke }, 1000)
    await wrapped.invoke({} as never)
    await wrapped.invoke({} as never)
    expect(signals[0]).not.toBe(signals[1])
  })

  it('does not mask a caller-initiated abort as a timeout', async () => {
    const controller = new AbortController()
    const wrapped = withCallTimeout({ invoke: stalledInvoke() }, 10_000)
    const pending = wrapped.invoke({} as never, { signal: controller.signal } as never).catch((e: unknown) => e)
    controller.abort(new Error('user cancelled'))
    const error = await pending
    expect(error).not.toBeInstanceOf(LangChainTimeoutError)
    expect((error as Error).message).toBe('user cancelled')
  })

  it('leaves other members of the chain reachable and bound', () => {
    class FakeChain {
      label = 'chain'
      invoke = jest.fn()
      describe() {
        return this.label
      }
    }
    const wrapped = withCallTimeout(new FakeChain(), 1000)
    expect(wrapped.describe()).toBe('chain')
  })
})
