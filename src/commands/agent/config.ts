import { Arguments, Argv, Options } from 'yargs'

import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'
import { AgentOperation } from '../../operations/agent'

export interface AgentCommandOptions extends BaseCommandOptions {
  operation: AgentOperation | 'schema'
  input?: string
  task?: AgentOperation
}

export type AgentCommandArgv = Arguments<AgentCommandOptions>

export const command = 'agent <operation>'

export const options = {
  input: {
    type: 'string',
    alias: 'f',
    description: 'Read the versioned JSON request from this file, or - for stdin.',
  },
  task: {
    type: 'string',
    choices: ['commit-draft', 'review', 'changelog', 'recap'],
    description: 'Operation whose schemas should be printed by `coco agent schema`.',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => yargs
  .positional('operation', {
    describe: 'Agent operation to run',
    type: 'string',
    choices: ['commit-draft', 'review', 'changelog', 'recap', 'schema'] as const,
  })
  .options(options)
  .check((argv) => {
    const typed = argv as { operation?: string; task?: string }
    if (typed.operation === 'schema' && !typed.task) {
      throw new Error('coco agent schema requires --task <operation>.')
    }
    return true
  })
  .usage(getCommandUsageHeader(command))
