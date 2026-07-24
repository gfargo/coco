import { Arguments, Argv } from 'yargs'

import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface McpOptions extends BaseCommandOptions {}
export type McpArgv = Arguments<McpOptions>

export const command = 'mcp'
export const options = {}
export const builder = (yargs: Argv) =>
  yargs
    .usage(getCommandUsageHeader(command))
    .epilogue(
      'When --repo is omitted the server starts without a pre-bound repository. ' +
      'It resolves the target repo per-call from the `repo` field in the tool input ' +
      'or from the MCP client\'s declared workspace roots. This allows a single ' +
      'global MCP configuration (e.g. `coco mcp`) to work in any editor workspace ' +
      'without hardcoding a path.',
    )
