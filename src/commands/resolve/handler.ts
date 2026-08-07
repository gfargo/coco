import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { ResolveArgv } from './config'
import { statusHandler } from './statusHandler'

/**
 * Dispatches `coco resolve [subcommand]` to the right implementation.
 * `explain` and default resolve mode are later work items (spec tasks
 * 8-11) — stubbed here with an explicit "not yet implemented" so their
 * behavior is defined rather than silently falling through.
 */
export const handler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const subcommand = argv.subcommand

  if (subcommand === 'status') {
    return statusHandler(argv, logger)
  }

  if (subcommand === 'explain') {
    logger.error('`coco resolve explain` is not yet implemented.', {})
    commandExit(1, 'resolve explain not yet implemented')
  }

  logger.error('`coco resolve` is not yet implemented. Try `coco resolve status`.', {})
  commandExit(1, 'resolve not yet implemented')
}
