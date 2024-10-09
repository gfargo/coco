import commandExecutor from '../../lib/utils/commandExecutor'
import { handler } from './handler'
import { builder, options } from './options'

export default {
  command: 'commit',
  desc: 'Summarize the staged changes in a commit message.',
  builder,
  handler: commandExecutor(handler),
  options,
}
