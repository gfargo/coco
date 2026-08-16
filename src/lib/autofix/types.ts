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
  /** The binary `run` spawns — exposed so callers can preview the resolved command line. */
  readonly binary: string
  /**
   * Builds the argv `run` will pass to `spawn`, filtered through this
   * adapter's option allowlist — EXCLUDING the trailing prompt argument.
   * The prompt is caller-supplied free text (often large, built from a
   * diff) and isn't the part a caller needs to review before running;
   * exposing just the flags lets `TaskList.autoFix()` show the user
   * exactly what will execute before they confirm it (#1840).
   */
  buildArgs(options?: Record<string, string>): string[]
  /**
   * @param prompt         The prompt to pass to the auto-fix CLI.
   * @param options        Extra CLI flags forwarded to the tool.
   * @param apiKey         A provider-derived key — only injected when the
   *                       ambient env var is unset (never overwrites a working
   *                       ambient credential).
   * @param forceApiKey    An explicit per-tool key supplied by the user.  When
   *                       present it is injected unconditionally, overriding any
   *                       ambient value.
   */
  run(
    prompt: string,
    options?: Record<string, string>,
    apiKey?: string,
    forceApiKey?: string
  ): Promise<void>
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
