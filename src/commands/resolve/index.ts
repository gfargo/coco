import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Inspect and AI-resolve merge/rebase conflicts',
  builder,
  handler: commandExecutor(handler),
  options,
}
