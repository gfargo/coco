import { ReviewFeedbackItem } from '../../commands/review/config'
import { buildPrompt } from './buildPrompt'
import { CodexAdapter } from './adapters/codex'
import { BaseAdapter, AutoFixConfig } from './types'

const registry: Record<string, BaseAdapter> = {
  codex: new CodexAdapter(),
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
  await adapter.run(prompt, config.autoFixToolOptions)
}
