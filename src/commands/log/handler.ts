import * as path from 'node:path'
import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import { handleResult } from '../../lib/ui/handleResult'
import { getCommitDetail, getLogRows } from './data'
import { startCocoUiFromLogArgv } from '../ui/handler'
import { formatCommitDetail, formatLogJson, formatLogTable } from './render'
import { LogArgv } from './config'

export const handler: CommandHandler<LogArgv> = async (argv) => {
  // `--repo <dir>` (alias `--cwd`) lets users target an arbitrary
  // repository without `cd`-ing first. Mirrors the same flag on
  // `coco ui`. chdir up-front so config + git both resolve against
  // the same canonical path. Resolve to absolute to avoid the
  // confusion of relative paths interacting with the chdir.
  if (argv.repo) {
    process.chdir(path.resolve(argv.repo))
  }

  const config = loadConfig<Config, LogArgv>(argv)
  const git = getRepo(argv.repo ? path.resolve(argv.repo) : undefined)
  const format = argv.format === 'json' ? 'json' : 'table'

  if (argv.commit) {
    const detail = await getCommitDetail(git, argv.commit)
    await handleResult({
      result: formatCommitDetail(detail, format),
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
