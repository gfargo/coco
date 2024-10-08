import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  interactive: boolean
  verbose: boolean
  help: boolean
}

export interface BaseCommandOptions extends BaseArgvOptions {}

export { Config }
