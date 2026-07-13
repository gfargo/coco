import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { isEmptyRepo } from '../../lib/simple-git/isEmptyRepo'
import { handleResult } from '../../lib/ui/handleResult'
import { getCommitDetail, getLogRows } from '../../git/logData'
import { startCocoUiFromLogArgv } from '../ui/handler'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { formatCommitDetail, formatLogJson, formatLogTable } from './render'
import { LogArgv } from './config'

/**
 * Friendly empty-repo message for the non-interactive log path.
 *
 * In `--json` mode we emit an empty array so machine consumers see a
 * well-defined "no commits" result without a parse error. In table
 * mode we print a human one-liner that names the next-step commands
 * the user is likely after. Either way we exit 0 — "no commits" is
 * a valid repo state, not a failure.
 */
function formatEmptyRepoResult(format: 'json' | 'table'): string {
  if (format === 'json') {
    return '[]'
  }
  return [
    "No commits yet — this looks like a fresh `git init`'d repo.",
    '',
    'Get started:',
    '  • `coco commit` to draft your first commit message with AI',
    '  • `git commit -m "chore: initial commit"` to commit by hand',
  ].join('\n')
}

export const handler: CommandHandler<LogArgv> = async (argv) => {
  // `--repo <dir>` (alias `--cwd`) — apply the global flag via the
  // shared helper. After this returns, `process.cwd()` and the git
  // instance are both bound to the targeted repo.
  const git = applyRepoFlag(argv)
  const config = loadConfig<Config, LogArgv>(argv)
  const format = argv.format === 'json' || argv.json ? 'json' : 'table'

  if (argv.commit) {
    const detail = await getCommitDetail(git, argv.commit)
    await handleResult({
      result: formatCommitDetail(detail, format),
      mode: 'stdout',
    })
    return
  }

  // Empty-repo short-circuit. Without this, the underlying `git log`
  // crashes the command and the user sees a raw "fatal: your current
  // branch 'main' does not have any commits yet" + a generic "Failed
  // to execute command" banner. We catch the unborn-HEAD state and
  // emit a friendly next-step hint (or an empty array in JSON mode)
  // and exit 0 — "no commits" is a valid repo state, not an error.
  //
  // Only applies to the non-interactive path: the TUI runtime gets
  // its own empty-state rendering inside the workstation.
  if (!argv.interactive && (await isEmptyRepo(git))) {
    await handleResult({
      result: formatEmptyRepoResult(format),
      mode: 'stdout',
    })
    return
  }

  // Interactive path defers the commit log fetch into the runtime
  // (#808) so the TUI mounts immediately with a "Loading commits…"
  // placeholder. The non-interactive (stdout) path still needs rows
  // up-front because the formatter just dumps a static snapshot.
  if (argv.interactive && format === 'table') {
    await startCocoUiFromLogArgv(argv, {
      config,
      git,
    })
    return
  }

  const rows = await getLogRows(git, argv)
  const result = format === 'json' ? formatLogJson(rows) : formatLogTable(rows)

  await handleResult({
    result,
    mode: 'stdout',
  })
}
