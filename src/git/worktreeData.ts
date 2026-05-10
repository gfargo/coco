import { SimpleGit } from 'simple-git'

export type WorktreeEntry = {
  path: string
  head?: string
  branch?: string
  detached: boolean
  bare: boolean
  prunable?: string
  current: boolean
  dirty: boolean
}

export type WorktreeOverview = {
  currentPath: string
  worktrees: WorktreeEntry[]
}

function shortBranch(branch: string | undefined): string | undefined {
  return branch?.replace(/^refs\/heads\//, '')
}

export function parseWorktreeList(output: string): Omit<WorktreeEntry, 'current' | 'dirty'>[] {
  return output
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const entry: Omit<WorktreeEntry, 'current' | 'dirty'> = {
        path: '',
        detached: false,
        bare: false,
      }

      block.split('\n').forEach((line) => {
        const [key, ...valueParts] = line.split(' ')
        const value = valueParts.join(' ')

        if (key === 'worktree') {
          entry.path = value
        } else if (key === 'HEAD') {
          entry.head = value
        } else if (key === 'branch') {
          entry.branch = shortBranch(value)
        } else if (key === 'detached') {
          entry.detached = true
        } else if (key === 'bare') {
          entry.bare = true
        } else if (key === 'prunable') {
          entry.prunable = value || 'prunable'
        }
      })

      return entry
    })
}

async function isWorktreeDirty(git: SimpleGit, path: string): Promise<boolean> {
  try {
    return Boolean((await git.raw(['-C', path, 'status', '--porcelain'])).trim())
  } catch {
    return false
  }
}

export async function getWorktreeListOverview(git: SimpleGit): Promise<WorktreeOverview> {
  const currentPath = (await git.revparse(['--show-toplevel'])).trim()
  const worktrees = parseWorktreeList(await git.raw(['worktree', 'list', '--porcelain']))

  return {
    currentPath,
    worktrees: await Promise.all(worktrees.map(async (worktree) => ({
      ...worktree,
      current: worktree.path === currentPath,
      dirty: await isWorktreeDirty(git, worktree.path),
    }))),
  }
}
