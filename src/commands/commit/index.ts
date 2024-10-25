import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Summarize the staged changes in a commit message.',
  builder,
  handler: commandExecutor(handler),
  options,
}
