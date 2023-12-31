import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  [x: string]: unknown
  interactive: boolean
  help: boolean
  verbose: boolean
}
export interface BaseCommandOptions extends BaseArgvOptions {
  service: Config['service']
  openAIApiKey: Config['openAIApiKey']
  huggingFaceHubApiKey: Config['huggingFaceHubApiKey']
  tokenLimit: Config['tokenLimit']
}

export { Config }
