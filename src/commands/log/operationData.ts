import { existsSync, readdirSync, readFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { SimpleGit } from 'simple-git'

export type GitOperationType = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export type ConflictFile = {
  path: string
  indexStatus: string
  worktreeStatus: string
}

export type ConflictMarker = {
  path: string
  line: number
  marker: string
}

export type GitHookOverview = {
  hooksPath: string
  configuredHooks: string[]
}

export type GitOperationOverview = {
  operation: GitOperationType
  conflictedFiles: ConflictFile[]
  conflictMarkers: ConflictMarker[]
  hooks: GitHookOverview
  aiConflictHelpAvailable: boolean
}

const OPERATION_PATHS: Array<{ operation: Exclude<GitOperationType, 'none'>; path: string }> = [
  { operation: 'merge', path: 'MERGE_HEAD' },
  { operation: 'rebase', path: 'rebase-merge' },
  { operation: 'rebase', path: 'rebase-apply' },
  { operation: 'cherry-pick', path: 'CHERRY_PICK_HEAD' },
  { operation: 'revert', path: 'REVERT_HEAD' },
]

const UNMERGED_STATUSES = new Set([
  'DD',
  'AU',
  'UD',
  'UA',
  'DU',
  'AA',
  'UU',
])

async function pathExists(git: SimpleGit, path: string): Promise<boolean> {
  return existsSync((await git.revparse(['--git-path', path])).trim())
}

export async function getInProgressOperationType(git: SimpleGit): Promise<GitOperationType> {
  for (const entry of OPERATION_PATHS) {
    if (await pathExists(git, entry.path)) {
      return entry.operation
    }
  }

  return 'none'
}

export function parseConflictedFiles(statusOutput: string): ConflictFile[] {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] || ' '
      const worktreeStatus = line[1] || ' '
      const rawPath = line.slice(3)
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) as string : rawPath

      return {
        path,
        indexStatus,
        worktreeStatus,
      }
    })
    .filter((file) => (
      UNMERGED_STATUSES.has(`${file.indexStatus}${file.worktreeStatus}`) ||
      file.indexStatus === 'U' ||
      file.worktreeStatus === 'U'
    ))
}

export async function getConflictedFiles(git: SimpleGit): Promise<ConflictFile[]> {
  return parseConflictedFiles(await git.raw(['status', '--porcelain']))
}

export function parseConflictMarkers(path: string, content: string): ConflictMarker[] {
  return content
    .split('\n')
    .map((line, index) => ({
      path,
      line: index + 1,
      marker: line.trim(),
    }))
    .filter((entry) => (
      entry.marker.startsWith('<<<<<<<') ||
      entry.marker.startsWith('=======') ||
      entry.marker.startsWith('>>>>>>>')
    ))
}

export async function getConflictMarkers(
  git: SimpleGit,
  files: ConflictFile[],
  limit = 12
): Promise<ConflictMarker[]> {
  const root = (await git.revparse(['--show-toplevel'])).trim()
  const markers: ConflictMarker[] = []

  for (const file of files) {
    if (markers.length >= limit) {
      break
    }

    const filePath = join(root, file.path)

    if (!existsSync(filePath)) {
      continue
    }

    markers.push(...parseConflictMarkers(file.path, readFileSync(filePath, 'utf8')))
  }

  return markers.slice(0, limit)
}

async function getConfiguredHooksPath(git: SimpleGit): Promise<string | undefined> {
  try {
    const output = (await git.raw(['config', '--get', 'core.hooksPath'])).trim()

    return output || undefined
  } catch {
    return undefined
  }
}

export async function getHookOverview(git: SimpleGit): Promise<GitHookOverview> {
  const configuredHooksPath = await getConfiguredHooksPath(git)
  const gitHooksPath = (await git.revparse(['--git-path', 'hooks'])).trim()
  const root = (await git.revparse(['--show-toplevel'])).trim()
  const hooksPath = configuredHooksPath
    ? isAbsolute(configuredHooksPath)
      ? configuredHooksPath
      : join(root, configuredHooksPath)
    : gitHooksPath
  const configuredHooks = existsSync(hooksPath)
    ? readdirSync(hooksPath)
      .filter((entry) => !entry.endsWith('.sample'))
      .sort()
    : []

  return {
    hooksPath,
    configuredHooks,
  }
}

export async function getGitOperationOverview(git: SimpleGit): Promise<GitOperationOverview> {
  const conflictedFiles = await getConflictedFiles(git)

  return {
    operation: await getInProgressOperationType(git),
    conflictedFiles,
    conflictMarkers: await getConflictMarkers(git, conflictedFiles),
    hooks: await getHookOverview(git),
    aiConflictHelpAvailable: conflictedFiles.length > 0,
  }
}

