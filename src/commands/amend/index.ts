import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Regenerate the last commit message from its diff and amend the commit.',
  builder,
  handler: commandExecutor(handler),
  options,
}
