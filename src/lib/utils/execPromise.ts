import { exec, ExecOptions } from 'child_process'

type ExecPromiseResult = {
  stdout: string
  stderr: string
}

/** Default wall-clock ceiling for a single exec call — a hung child process
 * (e.g. a probe command waiting on a TTY) would otherwise block forever. */
export const EXEC_DEFAULT_TIMEOUT_MS = 20_000

/** Default stdout/stderr buffer ceiling — well above Node's 1 MB default so
 * package-manager output doesn't overflow with ERR_CHILD_PROCESS_STDIO_MAXBUFFER. */
export const EXEC_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/**
 * Executes a command as a Promise and returns the result.
 *
 * @param command - The command to execute.
 * @param options - The options for the command execution.
 * @returns A Promise that resolves to an object containing the stdout and stderr of the command.
 * @throws If there is an error during command execution.
 */
export function execPromise(
  command: string,
  options: ExecOptions = {}
): Promise<ExecPromiseResult> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        timeout: EXEC_DEFAULT_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER_BYTES,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
        }
      }
    )
  })
}
