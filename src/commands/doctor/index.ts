import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Check your coco configuration for common issues and suggest fixes',
  builder,
  handler: commandExecutor(handler),
  options,
}
