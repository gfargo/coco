import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Show who last changed each line of a file, optionally explaining why (--explain).',
  builder,
  handler: commandExecutor(handler),
  options,
}
