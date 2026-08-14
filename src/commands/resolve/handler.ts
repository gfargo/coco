import { CommandHandler } from '../../lib/types'
import { ResolveArgv } from './config'
import { explainHandler } from './explainHandler'
import { resolveHandler } from './resolveHandler'
import { statusHandler } from './statusHandler'

/**
 * Dispatches `coco resolve [subcommand]` — `status` reports conflict state,
 * `explain` describes conflicts without resolving them, and omitting the
 * subcommand runs the default AI-resolution flow (interactive/dry-run/apply).
 */
export const handler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const subcommand = argv.subcommand

  if (subcommand === 'status') {
    return statusHandler(argv, logger)
  }

  if (subcommand === 'explain') {
    return explainHandler(argv, logger)
  }

  return resolveHandler(argv, logger)
}
