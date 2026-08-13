import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { ResolveArgv } from './config'
import { resolveHandler } from './resolveHandler'
import { statusHandler } from './statusHandler'

/**
 * Dispatches `coco resolve [subcommand]` — `status` reports conflict state,
 * `explain` is not yet implemented, and omitting the subcommand runs the
 * default AI-resolution flow (interactive/dry-run/apply).
 */
export const handler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const subcommand = argv.subcommand

  if (subcommand === 'status') {
    return statusHandler(argv, logger)
  }

  if (subcommand === 'explain') {
    logger.error(chalk.red('`coco resolve explain` is not yet implemented.'), {})
    commandExit(1, 'resolve explain: not yet implemented')
  }

  return resolveHandler(argv, logger)
}
