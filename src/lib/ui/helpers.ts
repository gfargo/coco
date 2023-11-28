import chalk from 'chalk'
import { CommitOptions } from '../../commands/commit/options'

export const isInteractive = (argv: CommitOptions) => {
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
