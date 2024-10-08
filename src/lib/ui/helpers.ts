import chalk from 'chalk'
import { loadConfig } from '../config/utils/loadConfig'

export const isInteractive = (config: ReturnType<typeof loadConfig>) => {
  return config?.mode === 'interactive' || config?.interactive
}

export const SEPERATOR = chalk.blue('─────────────')

export const LOGO = chalk.green(
  `┌────────────┐
│┌─┐┌─┐┌─┐┌─┐│
││  │ ││  │ ││
│└─┘└─┘└─┘└─┘│
└────────────┘`
)

export const USAGE_BANNER = chalk.green(
  `${LOGO}
v: ${process.env.npm_package_version}
`
)

export const CONFIG_ALREADY_EXISTS = (path: string) => {
  return `coco config found in '${path}', do you want to override it?`
}
