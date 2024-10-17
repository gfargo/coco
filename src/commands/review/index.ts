import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'review',
  desc: 'Review the staged changes',
  builder,
  handler: commandExecutor(handler),
  options,
}
