import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'recap',
  desc: 'Summarize the changes in the repository over a specified timeframe.',
  builder,
  handler: commandExecutor(handler),
  options,
}
