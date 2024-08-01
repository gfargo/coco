import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  [x: string]: unknown
  interactive: boolean
  help: boolean
  verbose: boolean
}
export interface BaseCommandOptions extends BaseArgvOptions {}

export { Config }
