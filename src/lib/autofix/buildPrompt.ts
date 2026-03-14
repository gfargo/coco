import * as fs from 'fs'
import * as path from 'path'
import { ReviewFeedbackItem } from '../../commands/review/config'

export async function buildPrompt(item: ReviewFeedbackItem): Promise<string> {
  const ext = path.extname(item.filePath).slice(1)

  let fileSection: string
  try {
    const contents = await fs.promises.readFile(item.filePath, 'utf-8')
    fileSection = `\`\`\`${ext}\n${contents}\n\`\`\``
  } catch {
    fileSection = `[WARNING: File "${item.filePath}" was not found on disk. Fix based on the issue description alone.]`
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
