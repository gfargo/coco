import { FileStatusResult } from 'simple-git'
import { getStatus } from './getStatus'
import { FileChange } from '../types'

export const getSummaryText = (file: FileStatusResult, change: Partial<FileChange>) => {
  const status = change.status || getStatus(file)

  if (change.oldFilepath) {
    return `${status}: ${change.oldFilepath} -> ${file.path}`
  }

  return `${status}: ${file.path}`
}
