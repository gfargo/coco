import { Arguments, Argv } from 'yargs'

import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface McpOptions extends BaseCommandOptions {
  /** Register write-capable tools (coco_commit_apply). Off by default. */
  allowWrite?: boolean
}
export type McpArgv = Arguments<McpOptions>

export const command = 'mcp'
export const options = {
  allowWrite: {
    description: 'Register write-capable tools (coco_commit_apply). Off by default.',
    type: 'boolean',
    default: false,
  },
} as const
export const builder = (yargs: Argv) =>
  yargs
    .usage(getCommandUsageHeader(command))
    .options(options)
    .epilogue(
      'When --repo is omitted the server starts without a pre-bound repository. ' +
      'It resolves the target repo per-call from the `repo` field in the tool input ' +
      'or from the MCP client\'s declared workspace roots. This allows a single ' +
      'global MCP configuration (e.g. `coco mcp`) to work in any editor workspace ' +
      'without hardcoding a path. ' +
      'By default the server is strictly read-only. Pass --allow-write to also register ' +
      'coco_commit_apply, which creates a git commit from the currently staged index ' +
      '(it never stages files itself and never pushes).',
    )
