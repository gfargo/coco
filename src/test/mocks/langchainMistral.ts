/**
 * Jest stub for `@langchain/mistralai`.
 *
 * The real package re-exports the official `@mistralai/mistralai` SDK, which
 * ships as pure ESM (`"type": "module"`, no CommonJS build). ts-jest runs tests
 * through CommonJS `require`, which cannot load that ESM entry, so any test that
 * touches the provider registry (which imports every provider) fails to load the
 * module graph.
 *
 * We only need `ChatMistralAI` to be a constructable class so `getLlm` can
 * `new` it and `instanceof` checks pass. The constructor stores its config for
 * any assertions; no network behavior is exercised in unit tests.
 */
export class ChatMistralAI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public readonly config: any) {}
}
