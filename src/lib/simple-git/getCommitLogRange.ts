import { DefaultLogFields, LogOptions, SimpleGit, TaskOptions } from 'simple-git';

type GetCommitLogRangeOptions = { git: SimpleGit; noMerges?: boolean }

/**
 * Retrieves the commit log range between two specified commits.
 *
 * @param from - The starting commit.
 * @param to - The ending commit.
 * @param options - Additional options for retrieving the commit log range.
 * @returns A promise that resolves to an array of commit log messages.
 * @throws If there is an error retrieving the commit log range.
 */
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
      ({ message, date, body, author_name, hash, author_email }) =>
        `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
    )
  } catch (error) {
    // If there's an error, handle it appropriately
    console.error('Error getting commit messages:', error)
    throw error
  }
}
