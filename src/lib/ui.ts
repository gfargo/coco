import chalk from 'chalk'

const SEPERATOR = chalk.blue('----------------')

export const logCommit = (commit: string) => {
  console.log(
    `\n${chalk.bgBlue(chalk.bold('Proposed Commit:'))}\n${SEPERATOR}\n${commit}\n${SEPERATOR}\n`
  )
}

export const logSuccess = () => {
  console.log(chalk.green(chalk.bold('\nAll set! 🦾🤖')))
}
