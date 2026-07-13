import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Manage git hooks that give plain `git commit` AI-generated messages.',
  builder,
  handler: commandExecutor(handler),
  options,
}
