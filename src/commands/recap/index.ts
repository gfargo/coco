import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Summarize the changes in the repository over a specified timeframe.',
  builder,
  handler: commandExecutor(handler),
  options,
}
