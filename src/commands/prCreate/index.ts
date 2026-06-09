import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Generate a pull request title and body from the branch diff and open it via gh.',
  builder,
  handler: commandExecutor(handler),
  options,
}
