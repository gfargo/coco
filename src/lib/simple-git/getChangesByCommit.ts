import { minimatch } from 'minimatch'
import path from 'path'
import { SimpleGit } from 'simple-git'
import { loadConfig } from '../config/utils/loadConfig'
import { FileChange } from '../types'
import { Logger } from '../utils/logger'
import { getStatus } from './getStatus'
import { getSummaryText } from './getSummaryText'
import { parseFileString } from "./parseFileString"

const config = loadConfig()

const DEFAULT_IGNORED_FILES = config?.ignoredFiles?.length ? config.ignoredFiles : []
const DEFAULT_IGNORED_EXTENSIONS = config?.ignoredExtensions?.length ? config.ignoredExtensions : []

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
 * @deprecated use `getChanges` instead
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

  const ignoredExtensionsSet = new Set(
    ignoredExtensions.map((extension) => extension.toLowerCase())
  )

  const filteredChanges = changes.filter((file) => {
    const extension = path.extname(file.filePath).toLowerCase()
    return (
      !ignoredExtensionsSet.has(extension) &&
      !ignoredFiles.some((ignoredPattern) => minimatch(file.filePath, ignoredPattern))
    )
  })

  return filteredChanges
}
