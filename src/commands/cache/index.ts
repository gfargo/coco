import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Manage coco caches (clear, info, parsers, prefetch, github)',
  builder,
  handler: commandExecutor(handler),
}
