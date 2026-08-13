import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { resolveHandler } from './resolveHandler'

export default {
  command,
  desc: 'Resolve merge/rebase conflicts with AI-proposed fixes (interactive by default; --dry-run / --apply for scripted flows)',
  builder,
  handler: commandExecutor(resolveHandler),
  options,
}
