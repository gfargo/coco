import commandExecutor from '../../lib/utils/commandExecutor'
import { builder, command, options } from './config'
import { handler } from './handler'

export default {
  command,
  desc: "Audit a commit range against the project's commitlint config (--fix to reword non-conforming subjects)",
  builder,
  handler: commandExecutor(handler),
  options,
}
