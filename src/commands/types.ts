import { Config } from '../lib/config/types'

interface BaseArgvOptions {
  interactive: boolean
  help: boolean
  verbose: boolean
}
export interface BaseCommandOptions extends BaseArgvOptions {
  [x: string]: unknown
  model: string
  openAIApiKey: string
  huggingFaceHubApiKey: string
  tokenLimit: number
}

export { Config }
