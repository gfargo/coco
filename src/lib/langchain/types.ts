import { type TiktokenModel } from '@langchain/openai'

export type LLMProvider = 'openai' | 'ollama' | 'anthropic'
export type DynamicModelTask =
  | 'summarize'
  | 'commit'
  | 'changelog'
  | 'review'
  | 'recap'
  | 'repair'
  | 'largeDiff'
export type DynamicModelPreference = 'cost' | 'balanced' | 'quality'

export type OpenAIModel =
  | TiktokenModel
  | 'gpt-4o-mini'
  | 'gpt-4o'
  | 'gpt-4.1'
  | 'gpt-4.1-mini' 
  | 'gpt-4.1-nano'

export type AnthropicModel =
  // Current generation (recommended for new users)
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001'
  | 'claude-haiku-4-5'
  | 'claude-opus-4-7'
  // Earlier 4.x line
  | 'claude-sonnet-4-0'
  // Pre-4.x (kept for users with existing service config pinned to these)
  | 'claude-3-7-sonnet-latest'
  | 'claude-3-5-haiku-latest'
  | 'claude-3-5-sonnet-latest'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-sonnet-20240620'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'

export type OllamaModel =
  | 'deepseek-r1:1.5b'
  | 'deepseek-r1:8b'
  | 'deepseek-r1:32b'
  | 'codegemma:2b'
  | 'codegemma:7b-code'
  | 'codegemma'
  | 'codellama:13b'
  | 'codellama:34b'
  | 'codellama:70b'
  | 'codellama:7b'
  | 'codellama:instruct'
  | 'codellama:latest'
  | 'codellama'
  | 'gemma:2b'
  | 'gemma:7b'
  | 'gemma:latest'
  | 'gemma'
  | 'llama2:13b'
  | 'llama2:70b'
  | 'llama2:chat'
  | 'llama2:latest'
  | 'llama2:text'
  | 'llama2'
  | 'llama3:70b-text'
  | 'llama3:70b'
  | 'llama3:latest'
  | 'llama3:text'
  | 'llama3.1:70b'
  | 'llama3.1:8b'
  | 'llama3.1:latest'
  | 'llama3.2'
  | 'llama3.2:latest'
  | 'llama3.2:1b'
  | 'llama3.2:3b'
  | 'llama3'
  | 'llava-llama3:latest'
  | 'dolphin-llama3:latest'
  | 'dolphin-llama3:8b'
  | 'dolphin-llama3:70b'
  // UNTESTED
  | 'mistral:7b'
  | 'mistral:latest'
  | 'mistral:text'
  | 'mistral'
  | 'phi3:14b'
  | 'phi3:3.8b'
  | 'phi3:instruct'
  | 'phi3:medium-128k'
  | 'phi3:medium-4k'
  | 'phi3:medium'
  | 'phi3'
  | 'qwen2:0.5b'
  | 'qwen2:1.5b'
  | 'qwen2:72b-text'
  | 'qwen2:72b'
  | 'qwen2'
  | 'qwen2.5-coder:latest'
  | 'qwen2.5-coder:0.5b'
  | 'qwen2.5-coder:1.5b'
  | 'qwen2.5-coder:3b'
  | 'qwen2.5-coder:7b'
  | 'qwen2.5-coder:14b'
  | 'qwen2.5-coder:32b'

export type LLMModel = OpenAIModel | OllamaModel | AnthropicModel
export type ConfiguredLLMModel = LLMModel | 'dynamic'
export type DynamicModelProfile = Partial<Record<DynamicModelTask, LLMModel>>

export type BaseLLMService = {
  provider: LLMProvider
  model: ConfiguredLLMModel
  /**
   * The maximum number of tokens per request.
   *
   * @default 2048
   */
  tokenLimit?: number
  /**
   * The temperature value controls the randomness of the generated output.
   * Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.
   *
   * @default 0.4
   */
  temperature?: number
  /**
   * The maximum number of requests to make concurrently.
   *
   * @default 6
   */
  maxConcurrent?: number
  /**
   * Minimum token count for a directory/file group to be eligible for summarization.
   * Groups below this threshold preserve raw diffs to maintain detail.
   *
   * @default 400
   */
  minTokensForSummary?: number
  /**
   * Maximum tokens allowed for a single file diff before it gets pre-summarized.
   * Prevents large files from biasing the overall summary.
   * If not set, defaults to 25% of tokenLimit.
   *
   * @default undefined (uses 0.25 * tokenLimit)
   */
  maxFileTokens?: number
  authentication: Authentication
  requestOptions?: {
    timeout?: number
    maxRetries?: number
  }
  /**
   * The maximum number of attempts for schema parsing with retry logic.
   *
   * @default 3
   */
  maxParsingAttempts?: number
  /**
   * Optional task-to-model overrides used when model is set to "dynamic".
   */
  dynamicModels?: DynamicModelProfile
  /**
   * Default dynamic routing preference when model is set to "dynamic".
   *
   * @default 'balanced'
   */
  dynamicModelPreference?: DynamicModelPreference
  /**
   * Opt-in fast paths that trade summary detail for speed. Each flag
   * here replaces an LLM summary call with a deterministic templated
   * extract for a specific file shape. Off by default — when enabled,
   * you accept that final commit messages on those file shapes may be
   * blander than LLM-generated summaries (the templated extract names
   * structural changes only).
   *
   * Lossless optimizations (cache, trivial-shape skip on pure
   * additions / deletions / renames / binary, sort discipline) ship
   * default-on and are not configured here.
   */
  fastPath?: {
    /**
     * Replace the LLM summary with a templated heading extract for
     * `.md` / `.mdx` / `.markdown` modification diffs that have clear
     * heading-level structural changes. Diffs without structural
     * signals (paragraph-only edits) still go to the LLM regardless
     * of this flag.
     *
     * Bench impact (synthetic): collapses docs-update-shaped commits
     * from ~24s cold to ~3ms (no LLM calls fire for the markdown
     * files). Real-world wall-clock savings depend on per-call LLM
     * latency.
     *
     * @default false
     */
    markdown?: boolean
    /**
     * Language-aware structural fast path (#883). Replace the LLM
     * summary with a symbol-level extract ("added parseRequest();
     * removed legacyParse()") for source files in the listed
     * languages. Off by default; quality is harder to validate than
     * the markdown fast path so we don't enable it without opt-in.
     *
     * Diffs without top-level structural signals (paragraph-only
     * body edits, formatting changes) still go to the LLM regardless
     * of this flag.
     *
     * Currently supports:
     *   - 'ts' : `.ts` / `.tsx` / `.mts` / `.cts`
     *   - 'js' : `.js` / `.jsx` / `.mjs` / `.cjs`
     *   - 'py' : `.py` / `.pyi`
     *   - 'rs' : `.rs`
     *   - 'go' : `.go`
     */
    languageAware?: {
      /**
       * Master switch. When false (default) the languageAware path
       * is skipped entirely regardless of `languages`.
       *
       * @default false
       */
      enabled?: boolean
      /**
       * Languages to opt in. Omit / empty to enable all supported
       * languages.
       */
      languages?: ('ts' | 'js' | 'py' | 'rs' | 'go')[]
    }
  }
}

type Authentication =
  | {
      type: 'None'
      credentials: undefined
    }
  | {
      type: 'OAuth'
      credentials: {
        clientId?: string
        clientSecret?: string
        token?: string
      }
    }
  | {
      type: 'APIKey'
      credentials: {
        apiKey: string
      }
    }

/**
 * Provider-specific extra options forwarded to the underlying LangChain client.
 * Decoupled from upstream input types so schema generation stays stable across
 * langchain releases.
 */
type OpenAIFields = Record<string, unknown>
type OllamaFields = Record<string, unknown>

export type OpenAILLMService = BaseLLMService & {
  provider: 'openai'
  model: OpenAIModel | 'dynamic'
  /**
   * Custom base URL for OpenAI-compatible APIs (e.g., OpenRouter, Azure OpenAI).
   * If not specified, uses the default OpenAI API endpoint.
   * 
   * @example "https://openrouter.ai/api/v1"
   * @example "https://your-resource.openai.azure.com"
   */
  baseURL?: string
  fields?: OpenAIFields
}

export type OllamaLLMService = BaseLLMService & {
  provider: 'ollama'
  model: OllamaModel | 'dynamic'
  endpoint: string
  fields?: OllamaFields
}

export type AnthropicLLMService = BaseLLMService & {
  provider: 'anthropic'
  model: AnthropicModel | 'dynamic'
  fields?: {
    temperature?: number
    maxTokens?: number
  }
}

export type LLMService = OpenAILLMService | OllamaLLMService | AnthropicLLMService
