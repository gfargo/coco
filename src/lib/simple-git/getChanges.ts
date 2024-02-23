import { SimpleGit } from 'simple-git'
import path from 'path'
import { minimatch } from 'minimatch'
import { FileChange } from '../types'
import { getStatus } from './getStatus'
import { getSummaryText } from './getSummaryText'
import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../config/constants'

export type GetChangesInput = {
  git: SimpleGit
  options?: {
    ignoredFiles?: string[]
    ignoredExtensions?: string[]
  }
}

export type GetChangesResult = {
  staged: FileChange[]
  unstaged?: FileChange[]
  untracked?: FileChange[]
}

export async function getChanges({ git, options }: GetChangesInput): Promise<GetChangesResult> {
  const { ignoredFiles = DEFAULT_IGNORED_FILES, ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS } =
    options || {}

  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: FileChange[] = []

  const status = await git.status()

  status.files.forEach((file) => {
    const fileChange: Partial<FileChange> = {
      filePath: file.path,
      oldFilePath: status.renamed.filter((renamed) => renamed.to === file.path)[0]?.from,
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
    const extension = path.extname(file.filePath).toLowerCase()
    return (
      !ignoredExtensionsSet.has(extension) &&
      !ignoredFiles.some((ignoredPattern) => minimatch(file.filePath, ignoredPattern))
    )
  })

  const filteredUnstaged = unstaged.filter((file) => {
    const extension = path.extname(file.filePath).toLowerCase()
    return (
      !ignoredExtensionsSet.has(extension) &&
      !ignoredFiles.some((ignoredPattern) => minimatch(file.filePath, ignoredPattern))
    )
  })

  const filteredUntracked = untracked.filter((file) => {
    const extension = path.extname(file.filePath).toLowerCase()
    return (
      !ignoredExtensionsSet.has(extension) &&
      !ignoredFiles.some((ignoredPattern) => minimatch(file.filePath, ignoredPattern))
    )
  })

  return {
    staged: filteredStaged,
    unstaged: filteredUnstaged,
    untracked: filteredUntracked,
  }
}
