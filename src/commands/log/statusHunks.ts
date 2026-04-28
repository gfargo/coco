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
