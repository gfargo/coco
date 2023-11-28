import { exec } from 'child_process'

type ExecPromiseResult = {
  stdout: string
  stderr: string
}

// Function to execute a command and return a promise
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
