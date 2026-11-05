import { LangChainTimeoutError } from '../errors'

/**
 * Default ceiling for a single summarization call on a hosted provider.
 * Generous on purpose: one `chain.invoke` is a map step plus a reduce step,
 * and reasoning models can take tens of seconds per step. It exists to turn
 * a stalled connection (SDK defaults are ~10 minutes) into a retryable
 * failure, not to police slow-but-healthy responses.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000

/**
 * Providers with no default ceiling. Ollama runs on the user's own hardware,
 * where a large model can legitimately take minutes per call, so it only
 * times out when `service.requestOptions.timeout` says so.
 */
const NO_DEFAULT_TIMEOUT_PROVIDERS = new Set(['ollama'])

/**
 * Resolve the per-call timeout in milliseconds, or `undefined` for none.
 * An explicit `service.requestOptions.timeout` always wins; otherwise hosted
 * providers get {@link DEFAULT_CALL_TIMEOUT_MS} and local ones get nothing.
 */
export function resolveCallTimeoutMs({
  provider,
  configured,
}: {
  provider?: string
  configured?: number
}): number | undefined {
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return configured
  }
  if (provider && NO_DEFAULT_TIMEOUT_PROVIDERS.has(provider)) return undefined
  return DEFAULT_CALL_TIMEOUT_MS
}

type Invocable = {
  invoke: (input: never, config?: { signal?: AbortSignal }) => Promise<unknown>
}

/**
 * Wrap a chain so every `invoke` gets its own fresh timeout, independent of
 * the provider SDK (Gemini, Bedrock, and Ollama ignore `requestOptions.timeout`
 * at the client level). A fresh signal per call means each retry attempt gets
 * a full budget.
 *
 * The signal goes into the chain's *input values*, not just the runnable
 * config: LangChain's classic `BaseChain.invoke` only watches `values.signal`
 * and drops `config.signal`. From the input values, `LLMChain` forwards it to
 * the model as a call option (`signal` is one of the chat model's `callKeys`),
 * so the in-flight HTTP request is aborted and the socket closed, not merely
 * abandoned. `BaseChain.invoke` also stops waiting on it, which hands control
 * back to the retry loop immediately.
 *
 * A timeout surfaces as a `LangChainTimeoutError` whose message says "timed
 * out", which the shared retry predicate treats as transient. A caller-supplied
 * signal that aborts is passed through untouched.
 */
export function withCallTimeout<T extends Invocable>(chain: T, timeoutMs: number | undefined): T {
  if (timeoutMs === undefined) return chain

  return new Proxy(chain, {
    get(target, prop) {
      if (prop !== 'invoke') {
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return async (input: Record<string, unknown>, config?: { signal?: AbortSignal }) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs)
        const signal = config?.signal ? AbortSignal.any([config.signal, timeoutSignal]) : timeoutSignal
        try {
          return await target.invoke({ ...input, signal } as never, { ...config, signal })
        } catch (error) {
          if (timeoutSignal.aborted && !config?.signal?.aborted) {
            throw new LangChainTimeoutError(`summarize: LLM call timed out after ${timeoutMs}ms`, {
              timeoutMs,
              cause: error instanceof Error ? error.message : String(error),
            })
          }
          throw error
        }
      }
    },
  })
}
