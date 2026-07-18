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

/**
 * True when a failed merge-machinery action (cherry-pick / revert /
 * rebase / pull) stopped on CONFLICTS — i.e. the repo is now sitting
 * mid-operation waiting for the user — as opposed to failing outright
 * for an unrelated reason (bad ref, network, hook rejection). Matches
 * git's conflict phrasings across versions and operations:
 *
 *   - "CONFLICT (content): Merge conflict in <file>"   (all operations)
 *   - "Automatic merge failed; fix conflicts and then commit the result."
 *     (merge / pull --no-rebase)
 *   - "error: could not apply <sha>..."                (cherry-pick / rebase)
 *   - "error: could not revert <sha>..."               (revert)
 *   - "Resolve all conflicts manually, mark them as resolved..."
 *     (rebase's hint block)
 *
 * Callers should join `message` + `details` before testing — several
 * action modules split git's multi-line stderr across both fields
 * (same contract as `isNonFastForwardPushError`).
 */
export function isOperationConflictError(message: string | undefined): boolean {
  return /CONFLICT \(|Merge conflict in |Automatic merge failed|could not apply|could not revert|Resolve all conflicts manually/i.test(message || '')
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

export function resolveConflictOurs(
  git: SimpleGit,
  path: string
): Promise<BranchActionResult> {
  return runAction(
    async () => {
      await git.raw(['checkout', '--ours', '--', path])
      await git.raw(['add', '--', path])
    },
    `Resolved ${path} (kept ours)`
  )
}

export function resolveConflictTheirs(
  git: SimpleGit,
  path: string
): Promise<BranchActionResult> {
  return runAction(
    async () => {
      await git.raw(['checkout', '--theirs', '--', path])
      await git.raw(['add', '--', path])
    },
    `Resolved ${path} (kept theirs)`
  )
}

/**
 * Intent-based conflict resolution. The workstation's `u`/`U` keys promise
 * "keep the incoming changes" / "keep your branch's version" — but git's
 * `--ours` / `--theirs` don't map to that constantly. During a merge,
 * cherry-pick, or revert, HEAD is the user's branch, so `--ours` is the
 * user's version. During a REBASE git replays the user's commits onto the
 * upstream: HEAD (and therefore `--ours`) is the upstream side, and the
 * user's own version is `--theirs`. Without this swap, "keep my version"
 * on a rebase conflict silently wrote and staged the upstream's version —
 * the opposite of the user's intent.
 */
export function resolveConflictKeepCurrentBranch(
  git: SimpleGit,
  operation: GitOperationType,
  path: string
): Promise<BranchActionResult> {
  return operation === 'rebase'
    ? resolveConflictTheirs(git, path)
    : resolveConflictOurs(git, path)
}

/** See {@link resolveConflictKeepCurrentBranch} — the incoming/other side. */
export function resolveConflictKeepIncoming(
  git: SimpleGit,
  operation: GitOperationType,
  path: string
): Promise<BranchActionResult> {
  return operation === 'rebase'
    ? resolveConflictOurs(git, path)
    : resolveConflictTheirs(git, path)
}

export function stageConflictResolved(
  git: SimpleGit,
  path: string
): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['add', '--', path]),
    `Staged ${path} (marked resolved)`
  )
}

export const operationActionTestInternals = {
  getOperationCommand,
}
