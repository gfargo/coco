import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Start the local coco MCP server over stdio (read-only by default; pass --allow-write to enable coco_commit_apply).',
  builder,
  handler,
  options,
}
