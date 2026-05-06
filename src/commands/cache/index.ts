import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Manage the diff-summary cache (clear, info)',
  builder,
  handler: commandExecutor(handler),
}
