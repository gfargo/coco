import chalk from 'chalk';
import { SEPERATOR } from "./helpers";

export function logResult(label: string, result: string) {
  console.log(
    `\n${chalk.bgBlue(chalk.bold(`Proposed ${label}:`))}\n${SEPERATOR}\n${result}\n${SEPERATOR}\n`
  );
}
