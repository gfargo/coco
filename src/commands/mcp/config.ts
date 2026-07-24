import { Arguments, Argv } from 'yargs'

import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface McpOptions extends BaseCommandOptions {}
export type McpArgv = Arguments<McpOptions>

export const command = 'mcp'
export const options = {}
export const builder = (yargs: Argv) => yargs.usage(getCommandUsageHeader(command))
