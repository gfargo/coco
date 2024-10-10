import chalk from 'chalk'
import { loadConfig } from '../config/utils/loadConfig'

export const isInteractive = (config: ReturnType<typeof loadConfig>) => {
  return config?.mode === 'interactive' || !!config?.interactive
}

export const SEPERATOR = chalk.blue('─────────────')

export const LOGO = chalk.green(
  `┌──────┐
│┏┏┓┏┏┓│
│┗┗┛┗┗┛│
└──────┘`
)

export const LOGO_SMALL = chalk.green(
  `┌────┐
│coco│
└────┘`)

export const USAGE_BANNER = chalk.green(
  `${LOGO}
${chalk.bgGreen(`\xa0v${process.env.npm_package_version}\xa0`)}
`
)

export const getCommandUsageHeader = (command: string) => {
  return chalk.green(
    `${USAGE_BANNER}\n${chalk.white('Command:')}\n\xa0\xa0\xa0\xa0\xa0 $0 ${chalk.greenBright(
      command
    )} [options]`
  )
}

export const CONFIG_ALREADY_EXISTS = (path: string) => {
  return `coco config found in '${path}', do you want to override it?`
}
