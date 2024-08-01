import { exec } from 'child_process'

type ExecPromiseResult = {
  stdout: string
  stderr: string
}

/**
 * Executes a command as a Promise and returns the result.
 *
 * @param command - The command to execute.
 * @param options - The options for the command execution.
 * @returns A Promise that resolves to an object containing the stdout and stderr of the command.
 * @throws If there is an error during command execution.
 */
export function execPromise(command: string, options = {}): Promise<ExecPromiseResult> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(`Execution error: ${error}`)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}
