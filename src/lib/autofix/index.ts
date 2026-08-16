import { ReviewFeedbackItem } from '../../commands/review/config'
import { buildPrompt } from './buildPrompt'
import { CodexAdapter } from './adapters/codex'
import { ClaudeAdapter } from './adapters/claude'
import { GeminiAdapter } from './adapters/gemini'
import { AutoFixVendor, BaseAdapter, AutoFixConfig } from './types'

const registry: Record<string, BaseAdapter> = {
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter(),
}

/**
 * Strict mapping from a coco LLM provider to its API-key vendor.
 *
 * Only the three cases where coco's provider key is literally the same
 * vendor's credential are included.  All other providers (azure, bedrock,
 * deepseek, groq, xai, together, fireworks, openrouter, lmstudio, vllm,
 * ollama) are intentionally absent — their keys are NOT openai/anthropic/
 * google keys and must never be forwarded to those vendors' CLIs.
 */
const PROVIDER_TO_VENDOR: Partial<Record<string, AutoFixVendor>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
}

/** A fully-resolved auto-fix, ready to preview before it runs. */
export type PreparedAutoFix = {
  /** The binary that `execute()` will spawn. */
  binary: string
  /** The resolved argv `execute()` will pass to `spawn`, excluding the trailing prompt (see `BaseAdapter.buildArgs`). */
  args: string[]
  /** Runs the adapter with the resolved prompt and credentials. */
  execute: () => Promise<void>
}

/**
 * Resolves which adapter/credentials/argv an auto-fix run would use,
 * without running it. Split out from `runAutoFix` so callers (`TaskList`)
 * can show the user the exact command before they confirm it (#1840) —
 * `TaskList.autoFix()` used to print only the finding's title and file
 * path, with no way to see what flags the spawned CLI would receive.
 */
export async function prepareAutoFix(
  item: ReviewFeedbackItem,
  config: AutoFixConfig,
  repoRoot: string
): Promise<PreparedAutoFix | undefined> {
  if (!config.autoFixTool) {
    return undefined
  }

  const adapter = registry[config.autoFixTool]
  if (!adapter) {
    throw new Error(`Unknown autoFixTool: "${config.autoFixTool}"`)
  }

  // Determine which key (if any) to pass to the adapter.
  //
  // Priority:
  //   1. config.autoFixToolApiKey — an explicit per-tool credential.  It is
  //      passed as `forceApiKey` so the adapter injects it unconditionally,
  //      even when an ambient env var is already populated.  The user
  //      explicitly chose this key; it must not be silently ignored.
  //   2. config.apiKey — coco's provider key, but ONLY when coco's provider
  //      maps to the same vendor as the adapter.  A key for provider X must
  //      never be written into vendor Y's environment variable.  Passed as the
  //      normal `apiKey` so the adapter still respects an ambient credential.
  //   3. undefined — let the adapter fall through to the ambient environment,
  //      which is the correct behaviour when no explicit key is needed.
  let keyToInject: string | undefined
  let forceKeyToInject: string | undefined

  if (config.autoFixToolApiKey) {
    forceKeyToInject = config.autoFixToolApiKey
  } else if (config.apiKey && config.provider) {
    const resolvedVendor = PROVIDER_TO_VENDOR[config.provider]
    if (resolvedVendor === adapter.vendor) {
      // Vendor match — coco's key belongs to the same vendor as the adapter.
      keyToInject = config.apiKey
    } else if (resolvedVendor !== undefined) {
      // coco has a recognized vendor but it doesn't match the adapter's vendor.
      // Warn so the user understands why no key was injected.
      console.warn(
        `[coco] auto-fix warning: coco is configured for provider "${config.provider}" ` +
          `but auto-fix tool "${config.autoFixTool}" uses a different vendor. ` +
          `The auto-fix tool will authenticate from your environment (${adapter.envVar}).`
      )
    } else {
      // coco's provider (e.g. azure, bedrock, ollama, openrouter, …) does not
      // have a direct vendor mapping — its key must never be forwarded.
      console.warn(
        `[coco] auto-fix warning: coco is configured for provider "${config.provider}" ` +
          `which does not have a direct vendor mapping to auto-fix tool "${config.autoFixTool}". ` +
          `The auto-fix tool will authenticate from your environment (${adapter.envVar}).`
      )
    }
  }

  const prompt = await buildPrompt(item, repoRoot)

  return {
    binary: adapter.binary,
    args: adapter.buildArgs(config.autoFixToolOptions),
    execute: () => adapter.run(prompt, config.autoFixToolOptions, keyToInject, forceKeyToInject),
  }
}

export async function runAutoFix(item: ReviewFeedbackItem, config: AutoFixConfig, repoRoot: string): Promise<void> {
  const prepared = await prepareAutoFix(item, config, repoRoot)
  if (!prepared) return
  await prepared.execute()
}
