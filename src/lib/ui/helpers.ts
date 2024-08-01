import chalk from 'chalk'
import { BaseArgvOptions } from '../../commands/types'

export const isInteractive = (argv: BaseArgvOptions) => {
  return argv?.mode === 'interactive' || argv.interactive
}

export const SEPERATOR = chalk.blue('─────────────')

export const LOGO = chalk.green(
  `┌────────────┐
│┌─┐┌─┐┌─┐┌─┐│
││  │ ││  │ ││
│└─┘└─┘└─┘└─┘│
└────────────┘ 
`
)

export const CONFIG_ALREADY_EXISTS = (path: string) => {
  return `coco config found in '${path}', do you want to override it?`
}
