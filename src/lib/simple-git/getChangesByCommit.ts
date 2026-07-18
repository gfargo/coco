import { SimpleGit } from 'simple-git'
import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../config/constants'
import { FileChange } from '../types'
import { Logger } from '../utils/logger'
import { filterIgnoredChanges } from './filterIgnoredChanges'
import { getStatus } from './getStatus'
import { getSummaryText } from './getSummaryText'
import { parseFileString } from "./parseFileString"

export type GetChangeByCommitInput = {
  commit: string
  options: {
    git: SimpleGit
    logger?: Logger
    ignoredFiles?: string[]
    ignoredExtensions?: string[]
  }
}

/**
 * Retrieves the changes made in a commit.
 *
 * @param commit - The commit hash.
 * @param options - Optional parameters for customization.
 * @returns A promise that resolves to an array of FileChange objects representing the changes made in the commit.
 */
export async function getChangesByCommit({
  commit,
  options: {
    git,
    ignoredFiles = DEFAULT_IGNORED_FILES,
    ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS,
  },
}: GetChangeByCommitInput): Promise<FileChange[]> {
  const changes: FileChange[] = []

  const diffSummary = await git.diffSummary([`${commit}^..${commit}`])

  diffSummary.files.forEach((file) => {
    const { filePath, oldFilePath } = parseFileString(file.file)

    const fileChange: Partial<FileChange> = {
      filePath,
      oldFilePath,
      status: getStatus(file),
    }

    fileChange.summary = getSummaryText(file, fileChange)

    changes.push(fileChange as FileChange)
  })

  return filterIgnoredChanges(changes, { ignoredFiles, ignoredExtensions })
}
