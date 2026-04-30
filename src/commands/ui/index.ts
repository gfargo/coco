import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Open the Coco Git workstation TUI.',
  builder,
  handler: commandExecutor(handler),
  options,
}
