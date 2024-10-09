import { DefaultLogFields, LogResult } from 'simple-git'

/**
 * Formats a commit log into a readable string format.
 *
 * @param commitLog - The commit log result containing an array of commit details.
 * @returns An array of formatted commit log strings.
 *
 * Each formatted string includes:
 * - The date of the commit in square brackets.
 * - The commit message.
 * - The commit body.
 * - The commit hash in parentheses.
 * - The author's name and email in angle brackets.
 */
export const formatCommitLog = (commitLog: LogResult<DefaultLogFields>) => {
  return commitLog.all.map(
    ({ message, date, body, author_name, hash, author_email }) =>
      `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
  )
}
