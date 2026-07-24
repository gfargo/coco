import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Start the local, read-only coco MCP server over stdio.',
  builder,
  handler,
  options,
}
