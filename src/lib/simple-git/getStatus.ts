import { FileChangeStatus } from '../types'
import { FileStatusResult } from 'simple-git'

export const getStatus = (
  file: FileStatusResult,
  location: 'index' | 'working_dir' = 'index'
): FileChangeStatus => {
  const statusCode = file[location] ? file[location] : file.index

  let status: FileChangeStatus
  switch (statusCode) {
    case 'A':
      status = 'added'
      break
    case 'D':
      status = 'deleted'
      break
    case 'M':
      status = 'modified'
      break
    case 'R':
      status = 'renamed'
      break
    case '?':
      status = 'untracked'
      break
    default:
      status = 'unknown'
      break
  }

  return status
}
