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

/**
 * Sectioned view of a (filtered) worktree file list. Groups are emitted
 * in canonical order (staged → unstaged → untracked) so the renderer
 * and the cursor model agree on layout regardless of the order
 * `git status --porcelain` happens to spit them out in. Empty
 * categories are omitted; `startIndex` is the offset of the group's
 * first file in the *flattened* sorted list — pair with
 * `flattenWorktreeGroups` so the canonical `selectedWorktreeFileIndex`
 * always points to the right file.
 */
export type WorktreeFileGroup = {
  state: WorktreeFileState
  files: WorktreeFile[]
  startIndex: number
}

const WORKTREE_GROUP_ORDER: WorktreeFileState[] = ['staged', 'unstaged', 'untracked']

export function groupWorktreeFiles(files: WorktreeFile[]): WorktreeFileGroup[] {
  const groups: WorktreeFileGroup[] = []
  let cursor = 0
  for (const groupState of WORKTREE_GROUP_ORDER) {
    const groupFiles = files.filter((file) => file.state === groupState)
    if (groupFiles.length > 0) {
      groups.push({ state: groupState, files: groupFiles, startIndex: cursor })
      cursor += groupFiles.length
    }
  }
  return groups
}

export function flattenWorktreeGroups(groups: WorktreeFileGroup[]): WorktreeFile[] {
  return groups.flatMap((group) => group.files)
}

export function findGroupForIndex(
  groups: WorktreeFileGroup[],
  index: number
): WorktreeFileGroup | undefined {
  for (const group of groups) {
    if (index >= group.startIndex && index < group.startIndex + group.files.length) {
      return group
    }
  }
  return undefined
}
