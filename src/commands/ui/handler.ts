import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import { LogArgv, LogOptions } from '../log/config'
import { GitLogRow, getLogRows } from '../log/data'
import { startInkInteractiveLog } from '../log/inkRuntime'
import { LogInkThemeConfig } from '../log/inkTheme'
import { UiArgv } from './config'

export function createLogArgvFromUiArgv(argv: UiArgv): LogArgv {
  return {
    $0: argv.$0,
    _: ['log'],
    all: argv.all,
    branch: argv.branch,
    format: 'table',
    interactive: true,
    limit: argv.limit,
    path: argv.path,
    verbose: argv.verbose,
    version: argv.version,
    help: argv.help,
  } as Arguments<LogOptions>
}

function createUiTheme(config: Config, argv: UiArgv): LogInkThemeConfig | undefined {
  if (!argv.theme) {
    return config.logTui?.theme
  }

  return {
    ...config.logTui?.theme,
    preset: argv.theme,
  }
}

type StartCocoUiFromLogArgvOptions = {
  config?: Config
  git?: SimpleGit
  rows?: GitLogRow[]
}

export async function startCocoUiFromLogArgv(
  logArgv: LogArgv,
  options: StartCocoUiFromLogArgvOptions = {}
): Promise<void> {
  const config = options.config || loadConfig<Config, LogArgv>(logArgv)
  const git = options.git || getRepo()
  const rows = options.rows || (await getLogRows(git, logArgv))

  await startInkInteractiveLog(git, rows, {}, {
    appLabel: 'coco ui',
    idleTips: config.logTui?.idleTips,
    initialView: 'history',
    logArgv,
    theme: config.logTui?.theme,
  })
}

export async function startCocoUi(argv: UiArgv): Promise<void> {
  const config = loadConfig<Config, UiArgv>(argv)
  const git = getRepo()
  const logArgv = createLogArgvFromUiArgv(argv)
  const rows = await getLogRows(git, logArgv)

  await startInkInteractiveLog(git, rows, {}, {
    appLabel: 'coco ui',
    idleTips: config.logTui?.idleTips,
    initialView: argv.view || 'history',
    logArgv,
    theme: createUiTheme(config, argv),
  })
}

export const handler: CommandHandler<UiArgv> = async (argv) => {
  await startCocoUi(argv)
}
