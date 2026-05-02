import { builder, command } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Check your coco configuration for common issues and suggest fixes',
  builder,
  handler,
}
