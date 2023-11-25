import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'init',
  desc: 'Setup coco for a new project or system',
  builder,
  handler,
  options,
}