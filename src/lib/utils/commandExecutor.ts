import { Argv } from 'yargs'
import { loadConfig } from '../config/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'
import { BaseArgvOptions } from '../../commands/types'

function commandExecutor<T extends Argv<BaseArgvOptions>['argv']>(handler: CommandHandler<T>) {
  return async (argv: T) => {
    const options = loadConfig(argv)
    const logger = new Logger(options)

    try {
      await handler(argv, logger)
    } catch (error) {
      logger.log('\nFailed to execute command', { color: 'yellow' })
      logger.verbose(`\nError: "${(error as Error).message}"`, { color: 'red' })
      logger.log('\nThanks for using coco, make it a great day! 👋🤖', { color: 'blue' })
      process.exit(0)
    }
  }
}

export default commandExecutor
