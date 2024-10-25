import chalk from 'chalk';
import { loadConfig } from '../config/utils/loadConfig';
import { getPackageJson } from '../utils/getPackageJson';

const { version } = getPackageJson();

export const isInteractive = (config: ReturnType<typeof loadConfig>) => {
  return config?.mode === 'interactive' || !!config?.interactive
}

export const SEPERATOR = chalk.blue('─────────────')
export const DIVIDER = chalk.dim(`\\`)

export const LOGO = chalk.green(
  `┌──────┐
│┏┏┓┏┏┓│
│┗┗┛┗┗┛│
└──────┘`
)

export const LOGO_SMALL = chalk.green(
  `┌────┐
│coco│
└────┘`
)

export const bannerWithHeader = (banner: string) => {
  return chalk.green(`┌────┐
│coco│ ${banner}
└────┘`)
}


export const USAGE_BANNER = chalk.green(
  `${LOGO}
${chalk.bgGreen(`\xa0v${version}\xa0`)}
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
  return `existing config found in '${path}', do you want to override it?`
}

const severityColors = [
  chalk.greenBright, // 1
  chalk.green, // 2
  chalk.cyan, // 3
  chalk.yellowBright, // 4
  chalk.yellow, // 5
  chalk.bgYellow, // 6
  chalk.red, // 7
  chalk.redBright, // 8
  chalk.bgRed, // 9
  chalk.bgRedBright, // 10
]

export const severityColor = (severity: number) => {
  return severityColors[Math.min(severity - 1, severityColors.length - 1)]
}

export const statusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return chalk.green
    case 'skipped':
      return chalk.yellow
    case 'omitted':
      return chalk.red
    default:
      return chalk.blue
  }
}

export const hotKey = (key: string) => chalk.dim(`(${key})`)
