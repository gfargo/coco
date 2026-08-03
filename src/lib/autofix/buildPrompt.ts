import * as fs from 'fs'
import * as path from 'path'
import { ReviewFeedbackItem } from '../../commands/review/config'
import { confineRepoPath } from '../utils/pathWithinRoot'

/** Maximum number of bytes to inline from a file into the prompt. */
const MAX_FILE_BYTES = 128_000

export async function buildPrompt(item: ReviewFeedbackItem, repoRoot: string): Promise<string> {
  const ext = path.extname(item.filePath).slice(1)

  let fileSection: string
  const confinement = confineRepoPath(item.filePath, repoRoot)

  if (!confinement.ok) {
    const reasonMsg =
      confinement.reason === 'absolute'
        ? 'absolute paths are not allowed'
        : confinement.reason === 'traversal'
          ? 'path traversal ("..") is not allowed'
          : 'path resolves outside the repository root'
    fileSection = `[REJECTED: "${item.filePath}" — ${reasonMsg}. Contents not read.]`
  } else {
    try {
      let contents = await fs.promises.readFile(confinement.absPath, 'utf-8')
      if (Buffer.byteLength(contents, 'utf-8') > MAX_FILE_BYTES) {
        contents = contents.slice(0, MAX_FILE_BYTES) + '\n[truncated: file exceeded inline size limit]'
      }
      fileSection = `\`\`\`${ext}\n${contents}\n\`\`\``
    } catch {
      fileSection = `[WARNING: File "${item.filePath}" was not found on disk. Fix based on the issue description alone.]`
    }
  }

  return `You are an expert software engineer. Fix the following code review issue.

## Issue
Title:    ${item.title}
Category: ${item.category}
Severity: ${item.severity}/10
File:     ${item.filePath}

## Problem
${item.summary}

## File Contents
${fileSection}

Fix the issue described above. Make only the changes necessary to resolve this specific problem.`
}
