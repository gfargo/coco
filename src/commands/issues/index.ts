import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'List GitHub issues for the current repository (read-only triage)',
  builder,
  handler: commandExecutor(handler),
  options,
}
