import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Generate a changelog from current or target branch, provided commit range, or since the last tag.',
  builder,
  handler: commandExecutor(handler),
  options,
}
