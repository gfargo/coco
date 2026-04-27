export class CommandExitError extends Error {
  readonly code: number

  constructor(code = 0, message = `Command exited with code ${code}`) {
    super(message)
    this.name = 'CommandExitError'
    this.code = code
  }
}

export function commandExit(code = 0, message?: string): never {
  throw new CommandExitError(code, message)
}

export function isCommandExitError(error: unknown): error is CommandExitError {
  return error instanceof CommandExitError
}
