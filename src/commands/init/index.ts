import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Install & configure coco globally or for the current project',
  builder,
  handler: commandExecutor(handler),
  options,
}
