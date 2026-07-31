import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Watch the repository and re-run review / commit-draft generation whenever changes settle',
  builder,
  handler: commandExecutor(handler),
  options,
}
