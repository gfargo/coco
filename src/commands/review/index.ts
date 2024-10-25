import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Review the staged changes',
  builder,
  handler: commandExecutor(handler),
  options,
}
