import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  interactive: boolean
  verbose: boolean
  version: boolean
  help: boolean
}

export interface BaseCommandOptions extends BaseArgvOptions {}

export { Config }
