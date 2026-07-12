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

/**
 * Parses `git status --porcelain -z` output (NUL-separated, no C-quoting).
 * Porcelain v1's default text format C-quotes "unusual" paths (non-ASCII
 * under `core.quotePath=true`, embedded quotes/tabs) — the literal quotes
 * and octal escapes then round-tripped into `git add`/`restore`/`diff`
 * pathspecs, which fail to match (#1597). `-z` disables quoting entirely
 * and reports rename/copy origin paths as a separate trailing field
 * instead of a ` -> ` separator in the same line, removing that
 * ambiguity too (a path containing a literal ` -> ` broke the v1 split).
 *
 * Record shape: each entry is one NUL-terminated `XY <path>` token;
 * rename/copy entries (X or Y is `R`/`C`) are followed by one additional
 * NUL-terminated token holding the origin path, which is consumed here
 * but not surfaced — same as the old parser, which only kept the
 * destination path from a v1 `old -> new` line.
 */
export function parsePorcelainStatus(output: string): WorktreeFile[] {
  const tokens = output.split('\0').filter((token) => token.length > 0)
  const files: WorktreeFile[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const indexStatus = token[0] || ' '
    const worktreeStatus = token[1] || ' '
    const path = token.slice(3)

    files.push({
      path,
      indexStatus,
      worktreeStatus,
      state: fileState(indexStatus, worktreeStatus),
    })

    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      // Skip the trailing origin-path token for this rename/copy entry.
      i += 1
    }
  }

  return files
}

export async function getWorktreeOverview(git: SimpleGit): Promise<WorktreeOverview> {
  const files = parsePorcelainStatus(await git.raw(['status', '--porcelain', '-z']))

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

/**
 * Optimistic stage/unstage flip for one file (#1353). The status
 * surface flips the toggled file's group in local context immediately
 * so `space` repaints on the keystroke; the awaited worktree refresh
 * that follows reconciles with git's truth (including when the git
 * call fails). Porcelain codes are approximations — good enough for
 * the one render frame they live for.
 */
export function optimisticToggleWorktreeOverview(
  overview: WorktreeOverview,
  path: string
): WorktreeOverview {
  const files = overview.files.map((file): WorktreeFile => {
    if (file.path !== path) return file
    if (file.state === 'staged') {
      return { ...file, state: 'unstaged', indexStatus: ' ', worktreeStatus: 'M' }
    }
    if (file.state === 'untracked') {
      return { ...file, state: 'staged', indexStatus: 'A', worktreeStatus: ' ' }
    }
    return {
      ...file,
      state: 'staged',
      indexStatus: file.worktreeStatus.trim() || 'M',
      worktreeStatus: ' ',
    }
  })
  return {
    ...overview,
    files,
    stagedCount: files.filter((file) => file.state === 'staged').length,
    unstagedCount: files.filter((file) => file.state === 'unstaged').length,
    untrackedCount: files.filter((file) => file.state === 'untracked').length,
  }
}
