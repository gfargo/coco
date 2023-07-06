import { ConvenientPatch } from 'nodegit'

export const getSummaryText = (patch: ConvenientPatch) => {
  const oldFilePath = patch.oldFile().path()
  const newFilePath = patch.newFile().path()

  let summary: string

  if (patch.isAdded()) {
    summary = `added: ${newFilePath}`
  } else if (patch.isDeleted()) {
    summary = `deleted: ${oldFilePath}`
  } else if (patch.isModified()) {
    summary = `modified: ${newFilePath}`
  } else if (patch.isRenamed()) {
    summary = `renamed: ${oldFilePath} -> ${newFilePath}`
  } else if (patch.isUntracked()) {
    summary = `untracked: ${newFilePath}`
  } else {
    summary = `unknown: ${newFilePath}`
  }

  return summary
}
