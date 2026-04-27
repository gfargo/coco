import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Explore commit history with a branch graph, filters, and commit details.',
  builder,
  handler: commandExecutor(handler),
  options,
}
