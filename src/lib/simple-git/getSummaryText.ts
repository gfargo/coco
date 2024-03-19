import { DiffResultBinaryFile, DiffResultTextFile, FileStatusResult } from 'simple-git'
import { getStatus } from './getStatus'
import { FileChange } from '../types'

/**
 * Returns the summary text for a file change.
 * 
 * @param file - The file status or diff result.
 * @param change - The partial file change object.
 * @returns The summary text for the file change.
 * @throws Error if the file type is invalid.
 */
export function getSummaryText(
  file: FileStatusResult | DiffResultTextFile | DiffResultBinaryFile,
  change: Partial<FileChange>
) {
  const status = change.status || getStatus(file)

  let filePath: string

  if ('path' in file) {
    filePath = file.path
  } else if ('file' in file) {
    filePath = change?.filePath || file.file
  } else {
    throw new Error('Invalid file type')
  }

  if (change.oldFilePath) {
    return `${status}: ${change.oldFilePath} -> ${filePath}`
  }

  return `${status}: ${filePath}`
}
