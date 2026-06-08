/**
 * Jest stub for `@langchain/aws`.
 *
 * The real package pulls in the AWS SDK v3 Bedrock client (`@aws-sdk/*`),
 * whose CommonJS bundles reach for Node internals (e.g. `fs.promises`) in a
 * way that ts-jest's CommonJS sandbox does not provide, so any test that
 * touches the provider registry (which imports every provider) fails to load
 * the module graph.
 *
 * We only need `ChatBedrockConverse` to be a constructable class so `getLlm`
 * can `new` it and `instanceof` checks pass. The constructor stores its config
 * for any assertions; no network/credential behavior is exercised in unit
 * tests.
 */
export class ChatBedrockConverse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public readonly config: any) {}
}
