import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import { handleResult } from '../../lib/ui/handleResult'
import { getCommitDetail, getLogRows } from './data'
import { startInkInteractiveLog } from './inkRuntime'
import { formatCommitDetail, formatLogJson, formatLogTable } from './render'
import { LogArgv } from './config'

export const handler: CommandHandler<LogArgv> = async (argv) => {
  const config = loadConfig<Config, LogArgv>(argv)
  const git = getRepo()
  const format = argv.format === 'json' ? 'json' : 'table'

  if (argv.commit) {
    const detail = await getCommitDetail(git, argv.commit)
    await handleResult({
      result: formatCommitDetail(detail, format),
      mode: 'stdout',
    })
    return
  }

  const rows = await getLogRows(git, argv)

  if (argv.interactive && format === 'table') {
    await startInkInteractiveLog(git, rows, {}, {
      theme: config.logTui?.theme,
    })
    return
  }

  const result = format === 'json' ? formatLogJson(rows) : formatLogTable(rows)

  await handleResult({
    result,
    mode: 'stdout',
  })
}
