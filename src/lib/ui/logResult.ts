import chalk from 'chalk';
import { SEPERATOR } from "./helpers";

export function logResult(result: string) {
  console.log(
    `\n${chalk.bgBlue(chalk.bold('Proposed Commit:'))}\n${SEPERATOR}\n${result}\n${SEPERATOR}\n`
  );
}
