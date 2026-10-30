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

/**
 * `snapshot.statusOutput` is the current worktree's `git status --porcelain`
 * output when the caller already has it (the context loader takes one per
 * refresh). It answers the current worktree's dirtiness, so only the others
 * spawn their own `git status` (#2209).
 */
export async function getWorktreeListOverview(
  git: SimpleGit,
  snapshot: { statusOutput?: string } = {}
): Promise<WorktreeOverview> {
  const currentPath = (await git.revparse(['--show-toplevel'])).trim()
  const worktrees = parseWorktreeList(await git.raw(['worktree', 'list', '--porcelain']))

  return {
    currentPath,
    worktrees: await Promise.all(worktrees.map(async (worktree) => {
      const current = worktree.path === currentPath
      const dirty = current && snapshot.statusOutput !== undefined
        ? Boolean(snapshot.statusOutput.trim())
        : await isWorktreeDirty(git, worktree.path)
      return { ...worktree, current, dirty }
    })),
  }
}
