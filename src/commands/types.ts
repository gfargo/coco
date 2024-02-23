import { Config } from '../lib/config/types'
import { LLMServiceAlias } from '../lib/langchain/types'

export interface BaseArgvOptions {
  [x: string]: unknown
  interactive: boolean
  help: boolean
  verbose: boolean
}
export interface BaseCommandOptions extends BaseArgvOptions {
  service: LLMServiceAlias
  openAIApiKey: string
  tokenLimit: number
}

export { Config }
