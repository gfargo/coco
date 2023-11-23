import { DefaultLogFields, LogOptions, SimpleGit, TaskOptions } from 'simple-git'

type GetCommitLogRangeOptions = { git: SimpleGit; noMerges?: boolean }

export async function getCommitLogRange(
  from: string,
  to: string,
  { noMerges, git }: GetCommitLogRangeOptions
): Promise<string[]> {
  try {
    const logOptions = { from: `${from}^1`, to, '--no-merges': noMerges } as
      | TaskOptions
      | LogOptions<DefaultLogFields>
      | undefined

    const commitLog = await git.log(logOptions)

    return commitLog.all.map(
      ({ message, date, body, author_name }) =>
        `[${date}] ${message}\n${body}\n - ${author_name}`
    )
  } catch (error) {
    // If there's an error, handle it appropriately
    console.error('Error getting commit messages:', error)
    throw error
  }
}
