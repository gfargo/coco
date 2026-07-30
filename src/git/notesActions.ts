import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

/**
 * Add or overwrite the `refs/notes/commits` note for a commit (#OSS-2057).
 * `-f` makes this idempotent for both the add and the edit case — a note
 * editor doesn't need to know whether one already exists.
 */
export function addOrEditCommitNote(git: SimpleGit, sha: string, body: string): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['notes', 'add', '-f', '-m', body, sha]),
    `Saved note on ${sha.slice(0, 8)}`
  )
}
