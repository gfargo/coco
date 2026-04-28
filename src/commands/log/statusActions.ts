import { SimpleGit } from 'simple-git'
import { WorktreeFile } from './statusData'

export type StatusActionResult = {
  ok: boolean
  message: string
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<StatusActionResult> {
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

export function stageFile(git: SimpleGit, file: WorktreeFile): Promise<StatusActionResult> {
  return runAction(
    () => git.raw(['add', '--', file.path]),
    `Staged ${file.path}`
  )
}

export function unstageFile(git: SimpleGit, file: WorktreeFile): Promise<StatusActionResult> {
  return runAction(
    () => git.raw(['restore', '--staged', '--', file.path]),
    `Unstaged ${file.path}`
  )
}

export function revertFile(git: SimpleGit, file: WorktreeFile): Promise<StatusActionResult> {
  if (file.state === 'untracked') {
    return Promise.resolve({
      ok: false,
      message: 'Untracked files are not reverted automatically.',
    })
  }

  return runAction(
    () => git.raw(['restore', '--', file.path]),
    `Reverted ${file.path}`
  )
}
