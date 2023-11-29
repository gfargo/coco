import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'init',
  desc: 'install & configure coco globally or for the current project',
  builder,
  handler: commandExecutor(handler),
  options,
}
