import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Generate a changelog from current or target branch or provided commit range.',
  builder,
  handler: commandExecutor(handler),
  options,
}
