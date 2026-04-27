import { CommandHandler } from '../../lib/types'
import { getRepo } from '../../lib/simple-git/getRepo'
import { handleResult } from '../../lib/ui/handleResult'
import { getCommitDetail, getLogRows } from './data'
import { formatCommitDetail, formatLogJson, formatLogTable } from './render'
import { LogArgv } from './config'

export const handler: CommandHandler<LogArgv> = async (argv) => {
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
  const result = format === 'json' ? formatLogJson(rows) : formatLogTable(rows)

  await handleResult({
    result,
    mode: 'stdout',
  })
}
