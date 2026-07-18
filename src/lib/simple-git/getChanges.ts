import { SimpleGit } from 'simple-git'
import { FileChange } from '../types'
import { getStatus } from './getStatus'
import { getSummaryText } from './getSummaryText'
import { filterIgnoredChanges } from './filterIgnoredChanges'
import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../config/constants'

export type GetChangesInput = {
  git: SimpleGit
  options?: {
    ignoredFiles?: string[]
    ignoredExtensions?: string[]
  }
}

export type GetChangesResult = {
  /** Changes that have been staged (added to the index). */
  staged: FileChange[]
  /** Changes in the working directory that are not yet staged. */
  unstaged: FileChange[]
  /** Files that are not tracked by Git. */
  untracked: FileChange[]
}

/**
 * Retrieves the changes in the Git repository.
 * 
 * @param {GetChangesInput} options - The options for retrieving the changes.
 * @returns {Promise<GetChangesResult>} A promise that resolves to the changes in the Git repository.
 */
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

  const filterOptions = { ignoredFiles, ignoredExtensions }

  return {
    staged: filterIgnoredChanges(staged, filterOptions),
    unstaged: filterIgnoredChanges(unstaged, filterOptions),
    untracked: filterIgnoredChanges(untracked, filterOptions),
  }
}
