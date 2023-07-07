import { minimatch } from 'minimatch'
import { ConvenientPatch } from 'nodegit'
import config from '../config'
import { getSummaryText } from './getSummaryText'
import { getStatus } from './getStatus'
import { FileChange } from '../types'

const DEFAULT_IGNORED_FILES = [
  ...(config?.ignoredFiles?.length && config?.ignoredFiles?.length > 0 ? config.ignoredFiles : []),
]

const DEFAULT_IGNORED_EXTENSIONS = [
  ...(config?.ignoredExtensions?.length && config?.ignoredExtensions?.length > 0
    ? config.ignoredExtensions
    : []),
]

type ParsePatchesOptions = {
  ignoredFiles?: string[]
  ignoredExtensions?: string[]
}

/**
 * Parse patches from a git diff.
 *
 * @param {ConvenientPatch[]} patches - An array of git patches.
 * @param {string[]} [options.ignoredFiles] - An optional array of file patterns to ignore.
 *   If not provided, it defaults to the `ignoredFiles` configuration value from the app's config.
 * @param {string[]} [options.ignoredExtensions] - An optional array of file extensions to ignore.
 *  If not provided, it defaults to the `ignoredExtensions` configuration value from the app's config.
 * @returns {Promise<FileChange[]>} A Promise that resolves to an array of file changes.
 **/
export const parsePatches = async (
  patches: ConvenientPatch[],
  {
    ignoredFiles = DEFAULT_IGNORED_FILES,
    ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS,
  }: ParsePatchesOptions
): Promise<FileChange[]> =>
  patches
    .map((patch: ConvenientPatch) => {
      const summary = getSummaryText(patch)
      const status = getStatus(patch)

      return {
        filepath: patch.newFile().path(),
        oldFilepath: status === 'renamed' ? patch.oldFile().path() : undefined,
        summary,
        status,
      }
    })
    .filter(Boolean)
    // Filter out ignored files & extensions...
    .filter(({ filepath }) => {
      if (!filepath) return false
      const extension = filepath.split('.').pop()
      // Remove ignored extensions
      if (extension && ignoredExtensions.includes(extension)) return false
      // Remove ignored files
      if (ignoredFiles.some((pattern) => minimatch(filepath, pattern))) return false
      return true
    })
