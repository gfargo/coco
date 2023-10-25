import { FileChangeStatus } from '../types'
import { DiffResultBinaryFile, DiffResultTextFile, FileStatusResult } from 'simple-git'

export const getStatus = (
  file: FileStatusResult | DiffResultTextFile | DiffResultBinaryFile,
  location: 'index' | 'working_dir' = 'index'
): FileChangeStatus => {
  if ('index' in file && 'working_dir' in file) {
    const statusCode = file[location];

    switch (statusCode) {
      case 'A':
        return 'added';
      case 'D':
        return 'deleted';
      case 'M':
        return 'modified';
      case 'R':
        return 'renamed';
      case '?':
        return 'untracked';
      default:
        return 'unknown';
    }
  } else if ('changes' in file && 'binary' in file) {
    if (file.changes === 0) return 'untracked';
    if (file.file.includes('=>')) return 'renamed';
    if (file.deletions === 0 && file.insertions > 0) return 'added';
    if (file.insertions === 0 && file.deletions > 0) return 'deleted';
    if ((file.insertions > 0 && file.deletions > 0) || file.changes > 0) return 'modified';
    return 'unknown';
  } else {
    throw new Error("Invalid file type");
  }
}

