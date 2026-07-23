import { ReviewFeedbackItem } from '../../commands/review/config'
import { buildPrompt } from './buildPrompt'
import { CodexAdapter } from './adapters/codex'
import { ClaudeAdapter } from './adapters/claude'
import { GeminiAdapter } from './adapters/gemini'
import { BaseAdapter, AutoFixConfig } from './types'

const registry: Record<string, BaseAdapter> = {
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter(),
}

export async function runAutoFix(item: ReviewFeedbackItem, config: AutoFixConfig): Promise<void> {
  if (!config.autoFixTool) {
    return
  }

  const adapter = registry[config.autoFixTool]
  if (!adapter) {
    throw new Error(`Unknown autoFixTool: "${config.autoFixTool}"`)
  }

  const prompt = await buildPrompt(item)
  await adapter.run(prompt, config.autoFixToolOptions, config.apiKey)
}
