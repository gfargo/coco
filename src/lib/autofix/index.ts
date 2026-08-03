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

export async function runAutoFix(item: ReviewFeedbackItem, config: AutoFixConfig): Promise<void> {
  if (!config.autoFixTool) {
    return
  }

  const adapter = registry[config.autoFixTool]
  if (!adapter) {
    throw new Error(`Unknown autoFixTool: "${config.autoFixTool}"`)
  }

  // Determine which key (if any) to pass to the adapter.
  //
  // Priority:
  //   1. config.autoFixToolApiKey — an explicit per-tool credential always wins.
  //   2. config.apiKey — coco's provider key, but ONLY when coco's provider
  //      maps to the same vendor as the adapter.  A key for provider X must
  //      never be written into vendor Y's environment variable.
  //   3. undefined — let the adapter fall through to the ambient environment,
  //      which is the correct behaviour when no explicit key is needed.
  let keyToInject: string | undefined

  if (config.autoFixToolApiKey) {
    keyToInject = config.autoFixToolApiKey
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

  const prompt = await buildPrompt(item)
  await adapter.run(prompt, config.autoFixToolOptions, keyToInject)
}
