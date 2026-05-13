import { SimpleGit } from 'simple-git'
import { extractLfsPatchChange, renderLfsSummary } from './lfsPointer'
import { WorktreeFile } from './statusData'

export type WorktreeFileDiff = {
  filePath: string
  hunkOffsets: number[]
  lines: string[]
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

function sectionLines(title: string, diff: string): string[] {
  const lines = diff.split('\n').map((line) => line.trimEnd())
  const body = lines.filter(Boolean)

  // #884 — replace pointer-body hunks for LFS-tracked files with a
  // single human-readable summary. Operates on the post-trim body so
  // the rest of the section (title + structure) is preserved.
  const lfsChange = extractLfsPatchChange(body)
  if (lfsChange) {
    return [title, renderLfsSummary(lfsChange)]
  }

  return [title, ...body]
}

export async function getWorktreeFileDiff(
  git: SimpleGit,
  file: WorktreeFile | undefined
): Promise<WorktreeFileDiff | undefined> {
  if (!file) {
    return undefined
  }

  if (file.state === 'untracked') {
    return {
      filePath: file.path,
      lines: [
        `Untracked file: ${file.path}`,
        '',
        'Git does not expose a line diff until the file is staged.',
      ],
      hunkOffsets: [],
      staged: false,
      unstaged: false,
      untracked: true,
    }
  }

  const stagedDiff = file.indexStatus.trim()
    ? await git.diff(['--staged', '--', file.path])
    : ''
  const unstagedDiff = file.worktreeStatus.trim()
    ? await git.diff(['--', file.path])
    : ''
  const lines = [
    ...(stagedDiff ? sectionLines('Staged changes', stagedDiff) : []),
    ...(stagedDiff && unstagedDiff ? [''] : []),
    ...(unstagedDiff ? sectionLines('Unstaged changes', unstagedDiff) : []),
  ]

  return {
    filePath: file.path,
    hunkOffsets: lines
      .map((line, index) => line.startsWith('@@') ? index : undefined)
      .filter((index): index is number => index !== undefined),
    lines: lines.length ? lines : ['No diff available for selected file.'],
    staged: Boolean(stagedDiff),
    unstaged: Boolean(unstagedDiff),
    untracked: false,
  }
}
