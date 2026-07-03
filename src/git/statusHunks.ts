import { spawn } from 'child_process'
import { formatPatch, parsePatch, StructuredPatch, StructuredPatchHunk } from 'diff'
import { SimpleGit } from 'simple-git'
import { WorktreeFile } from './statusData'

export type WorktreeHunkState = 'staged' | 'unstaged'

export type WorktreeHunk = {
  id: string
  filePath: string
  state: WorktreeHunkState
  patch: StructuredPatch
  hunk: StructuredPatchHunk
  header: string
  preview: string
}

export type WorktreeHunkOverview = {
  filePath: string
  hunks: WorktreeHunk[]
}

function hunkHeader(hunk: StructuredPatchHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

function hunkPreview(hunk: StructuredPatchHunk): string {
  return hunk.lines
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .slice(0, 4)
    .join(' ')
}

function hunkId(filePath: string, state: WorktreeHunkState, index: number): string {
  return `${filePath}::${state}-hunk-${index + 1}`
}

function parseHunks(filePath: string, state: WorktreeHunkState, diff: string): WorktreeHunk[] {
  const [patch] = parsePatch(diff)

  if (!patch) {
    return []
  }

  return patch.hunks.map((hunk, index) => ({
    id: hunkId(filePath, state, index),
    filePath,
    state,
    patch,
    hunk,
    header: hunkHeader(hunk),
    preview: hunkPreview(hunk),
  }))
}

function patchForHunk(hunk: WorktreeHunk): string {
  return formatPatch({
    ...hunk.patch,
    hunks: [hunk.hunk],
  })
}

async function applyPatch(
  git: SimpleGit,
  patch: string,
  args: string[],
): Promise<void> {
  const cwd = await git.revparse(['--show-toplevel'])

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Failed to apply hunk patch: ${stderr.trim()}`))
    })

    child.stdin.write(patch)
    child.stdin.end()
  })
}

async function applyPatchToIndex(
  git: SimpleGit,
  patch: string,
  options: { reverse?: boolean } = {}
): Promise<void> {
  const args = ['apply', '--cached', '-']

  if (options.reverse) {
    args.splice(2, 0, '--reverse')
  }

  await applyPatch(git, patch, args)
}

export async function getWorktreeHunks(
  git: SimpleGit,
  file: WorktreeFile | undefined
): Promise<WorktreeHunkOverview | undefined> {
  if (!file || file.state === 'untracked') {
    return undefined
  }

  const stagedDiff = file.indexStatus.trim()
    ? await git.diff(['--staged', '--', file.path])
    : ''
  const unstagedDiff = file.worktreeStatus.trim()
    ? await git.diff(['--', file.path])
    : ''
  const hunks = [
    ...parseHunks(file.path, 'staged', stagedDiff),
    ...parseHunks(file.path, 'unstaged', unstagedDiff),
  ]

  return {
    filePath: file.path,
    hunks,
  }
}

export type HunkLineRange = {
  /** Inclusive indices into `hunk.hunk.lines` (the hunk BODY, no @@ row). */
  start: number
  end: number
}

/**
 * Line-level staging core (#1358): synthesize a sub-hunk containing only
 * the selected +/- lines, with the unselected changes neutralized per
 * direction — the classic `git add -p` edit math:
 *
 *   STAGE (forward apply to the index — the index holds OLD content):
 *     unselected `-` → context (the old text stays in the index)
 *     unselected `+` → omitted (not being added yet)
 *   DISCARD (reverse apply to the worktree — the file holds NEW content):
 *     unselected `+` → context (the line stays in the file)
 *     unselected `-` → omitted (already absent; stays deleted)
 *
 * Line counts are recounted from the synthesized body. Returns undefined
 * when the selection contains no changed lines at all.
 */
export function sliceHunkLines(
  hunk: WorktreeHunk,
  range: HunkLineRange,
  mode: 'stage' | 'discard'
): WorktreeHunk | undefined {
  const src = hunk.hunk
  const lines: string[] = []
  let selectedChanges = 0

  src.lines.forEach((line, index) => {
    const selected = index >= range.start && index <= range.end
    const marker = line[0]
    if (marker === '-') {
      if (selected) {
        selectedChanges += 1
        lines.push(line)
      } else if (mode === 'stage') {
        lines.push(` ${line.slice(1)}`)
      }
      return
    }
    if (marker === '+') {
      if (selected) {
        selectedChanges += 1
        lines.push(line)
      } else if (mode === 'discard') {
        lines.push(` ${line.slice(1)}`)
      }
      return
    }
    // Context rows and `\ No newline` markers pass through.
    lines.push(line)
  })

  if (selectedChanges === 0) {
    return undefined
  }

  const oldLines = lines.filter((line) => line[0] === ' ' || line[0] === '-').length
  const newLines = lines.filter((line) => line[0] === ' ' || line[0] === '+').length
  const sliced = { ...src, lines, oldLines, newLines }
  return { ...hunk, hunk: sliced, header: hunkHeader(sliced), preview: hunkPreview(sliced) }
}

/** Stage only the selected lines of an UNSTAGED hunk into the index. */
export async function stageHunkLines(
  git: SimpleGit,
  hunk: WorktreeHunk,
  range: HunkLineRange
): Promise<void> {
  if (hunk.state !== 'unstaged') {
    throw new Error('Only unstaged hunks support line staging.')
  }
  const sliced = sliceHunkLines(hunk, range, 'stage')
  if (!sliced) {
    throw new Error('The selection contains no changed lines.')
  }
  await applyPatchToIndex(git, patchForHunk(sliced))
}

/** Discard only the selected lines of an UNSTAGED hunk from the worktree. */
export async function revertHunkLines(
  git: SimpleGit,
  hunk: WorktreeHunk,
  range: HunkLineRange
): Promise<void> {
  if (hunk.state !== 'unstaged') {
    throw new Error('Only unstaged hunks support line discard.')
  }
  const sliced = sliceHunkLines(hunk, range, 'discard')
  if (!sliced) {
    throw new Error('The selection contains no changed lines.')
  }
  await applyPatch(git, patchForHunk(sliced), ['apply', '--reverse', '-'])
}

export async function stageHunk(git: SimpleGit, hunk: WorktreeHunk): Promise<void> {
  if (hunk.state !== 'unstaged') {
    throw new Error('Only unstaged hunks can be staged.')
  }

  await applyPatchToIndex(git, patchForHunk(hunk))
}

export async function unstageHunk(git: SimpleGit, hunk: WorktreeHunk): Promise<void> {
  if (hunk.state !== 'staged') {
    throw new Error('Only staged hunks can be unstaged.')
  }

  await applyPatchToIndex(git, patchForHunk(hunk), { reverse: true })
}

export async function revertHunk(git: SimpleGit, hunk: WorktreeHunk): Promise<void> {
  const patch = patchForHunk(hunk)

  if (hunk.state === 'staged') {
    await applyPatch(git, patch, ['apply', '--reverse', '-'])
    await applyPatchToIndex(git, patch, { reverse: true })
    return
  }

  await applyPatch(git, patch, ['apply', '--reverse', '-'])
}

export const statusHunkTestInternals = {
  applyPatch,
  parseHunks,
  patchForHunk,
}
