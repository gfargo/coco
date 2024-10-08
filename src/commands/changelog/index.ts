import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'changelog',
  desc: 'Generate a changelog from current or target branch or provided commit range.',
  builder,
  handler: commandExecutor(handler),
  options,
}
