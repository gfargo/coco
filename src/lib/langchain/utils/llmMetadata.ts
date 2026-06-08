import type { LLMProvider } from '../types'

/**
 * Provider/endpoint metadata recorded against an LLM instance at construction
 * time. This replaces the old `extractLlmInfo` constructor-name/`lc_kwargs`
 * sniffing in `executeChain` — the factory knows the provider authoritatively,
 * so it stamps it here and the chain executors read it back. Keyed by a
 * WeakMap so it never leaks or mutates the instance.
 */
export type LlmMetadata = {
  provider: LLMProvider
  endpoint?: string
}

const registry = new WeakMap<object, LlmMetadata>()

export function recordLlmMetadata(llm: object, metadata: LlmMetadata): void {
  registry.set(llm, metadata)
}

export function getLlmMetadata(llm: object | null | undefined): Partial<LlmMetadata> {
  if (!llm) return {}
  return registry.get(llm) ?? {}
}
