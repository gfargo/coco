import { DefaultLogFields, ListLogLine } from 'simple-git'

/**
 * Format a single commit log entry into a readable string
 * @param commit - The commit log entry
 * @returns Formatted commit log string
 */
export function formatSingleCommit(commit: DefaultLogFields & ListLogLine): string {
  const { hash, date, message, body, author_name } = commit
  const shortHash = hash.substring(0, 7)
  
  return `Commit: ${shortHash}
Author: ${author_name}
Date: ${date}
Message: ${message}
${body ? `\nDetails: ${body}` : ''}`;
}