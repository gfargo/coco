import { DefaultLogFields, LogOptions, SimpleGit, TaskOptions } from 'simple-git';

type GetCommitLogRangeOptions = { git: SimpleGit; noMerges?: boolean }

/**
 * Retrieves the commit log range between two specified commits.
 *
 * @param from - The starting commit (can be a commit hash, HEAD reference, or branch name).
 * @param to - The ending commit (can be a commit hash, HEAD reference, or branch name).
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
    // Use the git range syntax directly (from..to) which works with both commit hashes and references
    const logOptions = { 
      from, 
      to, 
      '--no-merges': noMerges 
    } as TaskOptions | LogOptions<DefaultLogFields> | undefined

    const commitLog = await git.log(logOptions)

    return commitLog.all.map(
      ({ message, date, body, author_name, hash, author_email }) =>
        `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
    )
  } catch (error) {
    // If there's an error, handle it appropriately
    throw error
  }
}
