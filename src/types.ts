import { Config } from './lib/config/types'

export interface BaseCommandOptions {
  [x: string]: unknown
  help: boolean
  verbose: boolean
  model: string
  openAIApiKey: string
  huggingFaceHubApiKey: string
}

export { Config }
