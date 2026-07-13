import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Get, set, or unset a coco config key (get/set/unset/list)',
  builder,
  handler: commandExecutor(handler),
}
