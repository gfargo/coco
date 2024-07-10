import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'commit',
  desc: 'Write a commit message summarizing the staged changes.',
  builder,
  handler: commandExecutor(handler),
  options,
}
