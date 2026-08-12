import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Manage stacked branches: create a branch on top of another and show the stack.',
  builder,
  handler: commandExecutor(handler),
  options,
}
