import path from 'path'
import { minimatch } from 'minimatch'
import { FileChange } from '../types'

export type FilterIgnoredChangesOptions = {
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

/**
 * Filters out changes whose file path matches an ignored extension or an
 * ignored file glob pattern.
 */
export function filterIgnoredChanges<T extends FileChange>(
  changes: T[],
  { ignoredFiles, ignoredExtensions }: FilterIgnoredChangesOptions
): T[] {
  const ignoredExtensionsSet = new Set(
    ignoredExtensions.map((extension) => extension.toLowerCase())
  )

  return changes.filter((file) => {
    const extension = path.extname(file.filePath).toLowerCase()
    return (
      !ignoredExtensionsSet.has(extension) &&
      !ignoredFiles.some((ignoredPattern) => minimatch(file.filePath, ignoredPattern))
    )
  })
}
