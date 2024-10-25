import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Perform a code review on your changes',
  builder,
  handler: commandExecutor(handler),
  options,
}
