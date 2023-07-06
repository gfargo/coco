import { ConvenientPatch } from "nodegit"
import { FileChangeStatus } from "../../types"

export const getStatus = (patch: ConvenientPatch): FileChangeStatus => {
  let status: FileChangeStatus

  if (patch.isAdded()) {
    status = 'added'
  } else if (patch.isDeleted()) {
    status = 'deleted'
  } else if (patch.isModified()) {
    status = 'modified'
  } else if (patch.isRenamed()) {
    status = 'renamed'
  } else if (patch.isUntracked()) {
    status = 'untracked'
  } else if (patch.newFile()) {
    status = 'new file'
  } else {
    status = 'unknown'
  }

  return status
}
