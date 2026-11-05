import { PromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { LangChainCancelledError } from '../lib/langchain/errors'
import { LLMModel } from '../lib/langchain/types'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../lib/langchain/utils'
import { createSchemaParser } from '../lib/langchain/utils/createSchemaParser'
import { resolveDynamicService } from '../lib/langchain/utils/dynamicModels'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { loadConfig } from '../lib/config/utils/loadConfig'
import type { Config } from '../lib/config/types'
import type { DynamicModelTask } from '../lib/langchain/types'
import { Logger } from '../lib/utils/logger'

/** Minimal argv for config loading: these are workstation calls, not CLI commands. */
const WORKSTATION_ARGV: Record<string, unknown> = {
  $0: 'coco',
  _: ['commit'],
  interactive: false,
  verbose: false,
  version: false,
  help: false,
}

export type WorkstationChainResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; cancelled?: boolean }

/**
 * Run one structured LLM call for a workstation action (#2217): load config,
 * require an API key when the provider needs one, build the model for `task`,
 * and parse the answer with `schema`. Every failure comes back as a result,
 * never a throw, so a TUI action stays usable when the provider is down.
 */
export async function runWorkstationChain<T>(input: {
  /** Prompt with `{variables}` plus a `{format_instructions}` slot. */
  template: string
  variables: Record<string, string>
  schema: z.ZodType<T>
  /** Model-routing task: picks the cheap or strong model for `model: "dynamic"`. */
  task: DynamicModelTask
  /** Telemetry label (`reflog-explain`, `branch-name-suggest`, ...). */
  label: string
  signal?: AbortSignal
}): Promise<WorkstationChainResult<T>> {
  try {
    const config = loadConfig<Config, Record<string, unknown>>(WORKSTATION_ARGV)
    const key = getApiKeyForModel(config)
    if (config.service.authentication.type !== 'None' && !key) {
      return { ok: false, message: 'No API key configured. Set one via env or .coco.config.json first.' }
    }
    const { provider } = getModelAndProviderFromConfig(config)
    const service = resolveDynamicService(config, input.task)
    const llm = await getLlm(provider, service.model as LLMModel, { ...config, service })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser: any = createSchemaParser(input.schema as z.ZodType)

    const value = await executeChain<T>({
      llm,
      prompt: PromptTemplate.fromTemplate(input.template),
      variables: { ...input.variables, format_instructions: parser.getFormatInstructions() },
      parser,
      logger: new Logger({ silent: true }),
      signal: input.signal,
      metadata: { task: input.label, command: 'workstation', provider, model: String(service.model) },
    })
    return { ok: true, value }
  } catch (error) {
    if (error instanceof LangChainCancelledError) {
      return { ok: false, cancelled: true, message: 'Cancelled.' }
    }
    const first = (error as Error).message.split('\n').map((line) => line.trim()).find(Boolean)
    return { ok: false, message: first || 'unknown error' }
  }
}
