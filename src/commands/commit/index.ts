import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'commit',
  desc: 'Generate commit message',
  builder,
  handler,
  options,
}