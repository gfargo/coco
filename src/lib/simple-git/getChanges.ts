import { SimpleGit } from 'simple-git'
import path from 'path'
import config from '../config'
import { FileChange } from '../types'
import { getStatus } from './getStatus'
import { getSummaryText } from './getSummaryText'

const DEFAULT_IGNORED_FILES = [
  ...(config?.ignoredFiles?.length && config?.ignoredFiles?.length > 0 ? config.ignoredFiles : []),
]

const DEFAULT_IGNORED_EXTENSIONS = [
  ...(config?.ignoredExtensions?.length && config?.ignoredExtensions?.length > 0
    ? config.ignoredExtensions
    : []),
]

export type GetChangesArgs = {
  ignoredFiles?: string[]
  ignoredExtensions?: string[]
}

export type GetChangesResult = {
  staged: FileChange[]
  unstaged?: FileChange[]
  untracked?: FileChange[]
}

export async function getChanges(
  git: SimpleGit,
  options: GetChangesArgs = {}
): Promise<GetChangesResult> {
  const { ignoredFiles = DEFAULT_IGNORED_FILES, ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS } =
    options

  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: FileChange[] = []

  const status = await git.status()

  status.files.forEach((file) => {
    const fileChange: Partial<FileChange> = {
      filepath: file.path,
      oldFilepath: status.renamed.filter((renamed) => renamed.to === file.path)[0]?.from,
    }

    // Unstaged files
    if (file.working_dir !== '?' && file.working_dir !== ' ') {
      fileChange.status = getStatus(file, 'working_dir')
      fileChange.summary = getSummaryText(file, fileChange)
      unstaged.push(fileChange as FileChange)
    }

    // Staged files
    if (file.index !== ' ' && file.index !== '?') {
      fileChange.status = getStatus(file)
      fileChange.summary = getSummaryText(file, fileChange)
      staged.push(fileChange as FileChange)
    }

    // Untracked files
    if (file.working_dir === '?' && file.index === '?') {
      fileChange.status = 'added'
      fileChange.summary = getSummaryText(file, fileChange)
      untracked.push(fileChange as FileChange)
    }
  })

  const ignoredExtensionsSet = new Set(
    ignoredExtensions.map((extension) => extension.toLowerCase())
  )
  const filteredStaged = staged.filter((file) => {
    const extension = path.extname(file.filepath).toLowerCase()
    return !ignoredExtensionsSet.has(extension) && !ignoredFiles.includes(file.filepath)
  })

  const filteredUnstaged = unstaged.filter((file) => {
    const extension = path.extname(file.filepath).toLowerCase()
    return !ignoredExtensionsSet.has(extension) && !ignoredFiles.includes(file.filepath)
  })

  return {
    staged: filteredStaged,
    unstaged: filteredUnstaged,
    untracked,
  }
}
