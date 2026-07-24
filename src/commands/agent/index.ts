import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Run stable, non-interactive operations for agents and automation.',
  builder,
  handler,
  options,
}
