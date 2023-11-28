import fs from 'fs'
import { confirm } from '@inquirer/prompts'
import { ConfirmMessage } from '../types'

type UpdateFileSectionInput = {
  filePath: string
  startComment: string
  endComment: string
  getNewContent: () => Promise<string>
  confirmUpdate?: boolean
  confirmMessage?: ConfirmMessage
}

export async function updateFileSection({
  filePath,
  startComment,
  endComment,
  getNewContent,
  confirmUpdate = true,
  confirmMessage = (path: string) =>
    `A section already exists in ${path}, do you want to override it?`,
}: UpdateFileSectionInput) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').split(/\r?\n/) : []
  const newLines = []
  let foundSection = false

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === startComment) {
      foundSection = true

      if (confirmUpdate) {
        const confirmOverwrite = await confirm({
          message: typeof confirmMessage === 'function' ? confirmMessage(filePath) : confirmMessage,
          default: false,
        })

        if (!confirmOverwrite) {
          // keep all lines until the end comment
          while (i < lines.length && lines[i].trim() !== endComment) {
            newLines.push(lines[i])
            i++
          }
          newLines.push(endComment)
          continue
        }
      }

      newLines.push(startComment)
      // Insert the new content
      const newContent = await getNewContent()
      newLines.push(newContent)

      // Skip the existing content of the section
      while (i < lines.length && lines[i].trim() !== endComment) {
        i++
      }
      newLines.push(endComment)
      continue
    }

    if (!foundSection || lines[i].trim() !== endComment) {
      newLines.push(lines[i])
    }
  }

  // If section wasn't found, append it at the end
  if (!foundSection) {
    newLines.push('\n' + startComment)
    const newContent = await getNewContent()
    newLines.push(newContent)
    newLines.push(endComment)
  }

  // Write the updated contents back to the file
  fs.writeFileSync(filePath, newLines.join('\n'))
}
