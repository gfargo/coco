/**
 * The vendor identity of an auto-fix adapter.  Only the three CLI-backed
 * vendors that can receive a key from coco's provider are represented here;
 * the value is used to decide whether coco's resolved provider key belongs to
 * this adapter's vendor before it is injected into the child process env.
 */
export type AutoFixVendor = 'openai' | 'anthropic' | 'google'

export interface BaseAdapter {
  /** Vendor identity — used by runAutoFix to guard cross-vendor key injection. */
  readonly vendor: AutoFixVendor
  /** The environment-variable name this adapter reads its API key from. */
  readonly envVar: string
  run(prompt: string, options?: Record<string, string>, apiKey?: string): Promise<void>
}

export type AutoFixConfig = {
  autoFixTool?: string
  autoFixToolOptions?: Record<string, string>
  /**
   * API key resolved from coco's own LLM provider configuration.  Used only
   * when the adapter's vendor matches coco's configured provider; never
   * injected into a mismatched vendor's environment variable.
   */
  apiKey?: string
  /**
   * The LLM provider coco is configured to use (e.g. "openai", "anthropic",
   * "gemini").  Threaded in from review/handler so that runAutoFix can decide
   * whether config.apiKey belongs to the auto-fix tool's vendor.
   */
  provider?: string
  /**
   * An explicit API key for the auto-fix tool specifically.  When present it
   * is injected regardless of coco's configured provider, allowing users to
   * supply a separate credential for the fix CLI.
   */
  autoFixToolApiKey?: string
}
