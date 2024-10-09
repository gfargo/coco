import { DefaultLogFields, LogResult } from 'simple-git'

export const formatCommitLog = (commitLog: LogResult<DefaultLogFields>) => {
  return commitLog.all.map(
    ({ message, date, body, author_name, hash, author_email }) =>
      `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
  )
}
