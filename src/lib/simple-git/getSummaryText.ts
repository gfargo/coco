import { DiffResultBinaryFile, DiffResultTextFile, FileStatusResult } from 'simple-git'
import { getStatus } from './getStatus'
import { FileChange } from '../types'

export const getSummaryText = (
  file: FileStatusResult | DiffResultTextFile | DiffResultBinaryFile,
  change: Partial<FileChange>
) => {
  const status = change.status || getStatus(file)
  
  let filePath: string;

  if ('path' in file) {
    filePath = file.path;
  } else if ('file' in file) {
    filePath = change?.filePath || file.file;
  } else {
    throw new Error("Invalid file type");
  }

  if (change.oldFilePath) {
    return `${status}: ${change.oldFilePath} -> ${filePath}`
  }

  return `${status}: ${filePath}`
}
