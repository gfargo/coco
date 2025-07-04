import { DefaultLogFields, LogOptions, SimpleGit, TaskOptions } from 'simple-git';

type GetCommitLogRangeOptions = { git: SimpleGit; noMerges?: boolean }

/**
 * Retrieves the commit log range between two specified commits (inclusive of both commits).
 *
 * @param from - The starting commit (can be a commit hash, HEAD reference, or branch name). This commit will be included in the results.
 * @param to - The ending commit (can be a commit hash, HEAD reference, or branch name). This commit will be included in the results.
 * @param options - Additional options for retrieving the commit log range.
 * @returns A promise that resolves to an array of commit log messages, including both the 'from' and 'to' commits.
 * @throws If there is an error retrieving the commit log range.
 */
export async function getCommitLogRange(
  from: string,
  to: string,
  { noMerges, git }: GetCommitLogRangeOptions
): Promise<string[]> {
  try {
    // Use from^..to to include the 'from' commit in the range
    // This works because from^..to means "commits reachable from 'to' but not from the parent of 'from'"
    const logOptions = { 
      from: `${from}^`, 
      to, 
      '--no-merges': noMerges 
    } as TaskOptions | LogOptions<DefaultLogFields> | undefined

    const commitLog = await git.log(logOptions)

    return commitLog.all.map(
      ({ message, date, body, author_name, hash, author_email }) =>
        `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
    )
  } catch (error) {
    // If from^ fails (e.g., 'from' is the first commit), fall back to using from..to and manually adding the 'from' commit
    if (error instanceof Error && error.message.includes('unknown revision')) {
      try {
        // Get the 'from' commit separately
        const fromCommitLog = await git.log({ from: from, maxCount: 1 })
        const fromCommit = fromCommitLog.latest
        
        // Get the range from..to (excluding 'from')
        const rangeLogOptions = { 
          from, 
          to, 
          '--no-merges': noMerges 
        } as TaskOptions | LogOptions<DefaultLogFields> | undefined
        
        const rangeCommitLog = await git.log(rangeLogOptions)
        
        // Combine the 'from' commit with the range commits
        const allCommits = fromCommit 
          ? [fromCommit, ...rangeCommitLog.all]
          : rangeCommitLog.all
        
        return allCommits.map(
          ({ message, date, body, author_name, hash, author_email }) =>
            `[${date}] ${message}\n${body}\n(${hash}) - ${author_name}<${author_email}>`
        )
      } catch (fallbackError) {
        throw fallbackError
      }
    }
    
    throw error
  }
}
