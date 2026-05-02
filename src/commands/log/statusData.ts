import { SimpleGit } from 'simple-git'

export type WorktreeFileState = 'staged' | 'unstaged' | 'untracked'

export type WorktreeFile = {
  path: string
  indexStatus: string
  worktreeStatus: string
  state: WorktreeFileState
}

export type WorktreeOverview = {
  files: WorktreeFile[]
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
}

function fileState(indexStatus: string, worktreeStatus: string): WorktreeFileState {
  if (indexStatus === '?' && worktreeStatus === '?') {
    return 'untracked'
  }

  if (indexStatus.trim()) {
    return 'staged'
  }

  return 'unstaged'
}

export function parsePorcelainStatus(output: string): WorktreeFile[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] || ' '
      const worktreeStatus = line[1] || ' '
      const rawPath = line.slice(3)
      const renamePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) as string : rawPath

      return {
        path: renamePath,
        indexStatus,
        worktreeStatus,
        state: fileState(indexStatus, worktreeStatus),
      }
    })
}

export async function getWorktreeOverview(git: SimpleGit): Promise<WorktreeOverview> {
  const files = parsePorcelainStatus(await git.raw(['status', '--porcelain']))

  return {
    files,
    stagedCount: files.filter((file) => file.state === 'staged').length,
    unstagedCount: files.filter((file) => file.state === 'unstaged').length,
    untrackedCount: files.filter((file) => file.state === 'untracked').length,
  }
}

/**
 * Visibility mask for the status surface (#776). Each flag controls
 * whether files of that staging category are rendered. The all-on
 * default is the no-op identity — `applyStatusFilterMask` returns the
 * input array unchanged.
 */
export type WorktreeFileVisibilityMask = {
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export function applyStatusFilterMask(
  files: WorktreeFile[],
  mask: WorktreeFileVisibilityMask
): WorktreeFile[] {
  if (mask.staged && mask.unstaged && mask.untracked) {
    return files
  }
  return files.filter((file) => mask[file.state])
}
