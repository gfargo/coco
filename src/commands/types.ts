import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  interactive: boolean
  help: boolean
  verbose: boolean
}
export interface BaseCommandOptions extends BaseArgvOptions {
  [x: string]: unknown
  service: Config['service']
  openAIApiKey: Config['openAIApiKey']
  huggingFaceHubApiKey: Config['huggingFaceHubApiKey']
  tokenLimit: Config['tokenLimit']
}

export { Config }
