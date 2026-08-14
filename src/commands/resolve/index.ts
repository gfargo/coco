import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: 'Resolve merge/rebase conflicts with AI-proposed fixes (interactive by default; --dry-run / --apply for scripted flows). `status` reports conflict state.',
  builder,
  handler: commandExecutor(handler),
  options,
}
