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

/**
 * Group-level batch ops triggered by Enter on a status group header
 * (staged / unstaged / untracked). Pass the files belonging to that
 * group; the helpers run a single `git add` / `git restore --staged`
 * with all paths in one invocation rather than looping per-file —
 * faster + atomic from the user's point of view.
 */
export function stageAllFiles(
  git: SimpleGit,
  files: WorktreeFile[]
): Promise<StatusActionResult> {
  if (files.length === 0) {
    return Promise.resolve({ ok: false, message: 'No files to stage' })
  }
  return runAction(
    () => git.raw(['add', '--', ...files.map((file) => file.path)]),
    `Staged ${files.length} ${files.length === 1 ? 'file' : 'files'}`
  )
}

export function unstageAllFiles(
  git: SimpleGit,
  files: WorktreeFile[]
): Promise<StatusActionResult> {
  if (files.length === 0) {
    return Promise.resolve({ ok: false, message: 'No files to unstage' })
  }
  return runAction(
    () => git.raw(['restore', '--staged', '--', ...files.map((file) => file.path)]),
    `Unstaged ${files.length} ${files.length === 1 ? 'file' : 'files'}`
  )
}

/**
 * Stage everything in the worktree — modifications, new files, and
 * deletions — in one shot (`git add -A`). The `A` hotkey + the `:`
 * palette's "stage all" both route here.
 */
export function stageAll(git: SimpleGit): Promise<StatusActionResult> {
  return runAction(
    () => git.raw(['add', '-A']),
    'Staged all changes'
  )
}

/**
 * Stage files matching one or more git pathspecs (`git add -- <spec…>`).
 * Powers the typed "stage…" prompt (`+`): the user types a path, a
 * directory, a glob like `*.ts`, or a space-separated list, and git's
 * own pathspec matching does the rest. Args are passed directly (no
 * shell), so the globs are interpreted by git, not the shell.
 */
export function stagePathspec(git: SimpleGit, pathspec: string): Promise<StatusActionResult> {
  const specs = pathspec.trim().split(/\s+/).filter(Boolean)
  if (specs.length === 0) {
    return Promise.resolve({ ok: false, message: 'Enter a pathspec to stage (e.g. . or src/ or *.ts).' })
  }
  return runAction(
    () => git.raw(['add', '--', ...specs]),
    `Staged ${specs.join(' ')}`
  )
}
