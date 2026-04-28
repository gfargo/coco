import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { GitOperationType } from './operationData'

type OperationCommand = {
  args: string[]
  successMessage: string
}

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    const details = compactOutputLines((error as Error).message)

    return {
      ok: false,
      message: details[0] || 'Git operation action failed.',
      details: details.slice(1, 8),
    }
  }
}

function getOperationCommand(
  operation: GitOperationType,
  action: 'continue' | 'abort' | 'skip'
): OperationCommand | undefined {
  if (operation === 'none') {
    return undefined
  }

  if (operation === 'merge') {
    if (action === 'continue') {
      return {
        args: ['merge', '--continue'],
        successMessage: 'Continued merge',
      }
    }

    if (action === 'abort') {
      return {
        args: ['merge', '--abort'],
        successMessage: 'Aborted merge',
      }
    }

    return undefined
  }

  return {
    args: [operation, `--${action}`],
    successMessage: action === 'skip'
      ? `Skipped ${operation}`
      : action === 'continue'
        ? `Continued ${operation}`
        : `Aborted ${operation}`,
  }
}

export function continueOperation(
  git: SimpleGit,
  operation: GitOperationType
): Promise<BranchActionResult> {
  const command = getOperationCommand(operation, 'continue')

  if (!command) {
    return Promise.resolve({
      ok: false,
      message: operation === 'none'
        ? 'No in-progress Git operation to continue.'
        : `Continue is not supported for ${operation}.`,
    })
  }

  return runAction(
    () => git.raw(command.args),
    command.successMessage
  )
}

export function abortOperation(
  git: SimpleGit,
  operation: GitOperationType
): Promise<BranchActionResult> {
  const command = getOperationCommand(operation, 'abort')

  if (!command) {
    return Promise.resolve({
      ok: false,
      message: 'No in-progress Git operation to abort.',
    })
  }

  return runAction(
    () => git.raw(command.args),
    command.successMessage
  )
}

export function skipOperation(
  git: SimpleGit,
  operation: GitOperationType
): Promise<BranchActionResult> {
  const command = getOperationCommand(operation, 'skip')

  if (!command) {
    return Promise.resolve({
      ok: false,
      message: operation === 'merge'
        ? 'Skip is not supported for merge operations.'
        : 'No in-progress Git operation to skip.',
    })
  }

  return runAction(
    () => git.raw(command.args),
    command.successMessage
  )
}

export const operationActionTestInternals = {
  getOperationCommand,
}
