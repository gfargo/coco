import { DefaultLogFields, LogOptions, SimpleGit, TaskOptions, ListLogLine } from 'simple-git';

type GetCommitLogRangeDetailsOptions = { git: SimpleGit; noMerges?: boolean }

export type CommitDetails = DefaultLogFields & ListLogLine;

/**
 * Retrieves the detailed commit log range between two specified commits (inclusive of both commits).
 *
 * @param from - The starting commit (can be a commit hash, HEAD reference, or branch name). This commit will be included in the results.
 * @param to - The ending commit (can be a commit hash, HEAD reference, or branch name). This commit will be included in the results.
 * @param options - Additional options for retrieving the commit log range.
 * @returns A promise that resolves to an array of commit details objects.
 * @throws If there is an error retrieving the commit log range.
 */
export async function getCommitLogRangeDetails(
  from: string,
  to: string,
  { noMerges, git }: GetCommitLogRangeDetailsOptions
): Promise<CommitDetails[]> {
  try {
    const logOptions = { 
      from: `${from}^`, 
      to, 
      '--no-merges': noMerges 
    } as TaskOptions | LogOptions<DefaultLogFields> | undefined

    const commitLog = await git.log(logOptions)

    return [...commitLog.all]
  } catch (error) {
    if (error instanceof Error && error.message.includes('unknown revision')) {
      try {
        const fromCommitLog = await git.log({ from: from, maxCount: 1 })
        const fromCommit = fromCommitLog.latest
        
        const rangeLogOptions = { 
          from, 
          to, 
          '--no-merges': noMerges 
        } as TaskOptions | LogOptions<DefaultLogFields> | undefined
        
        const rangeCommitLog = await git.log(rangeLogOptions)
        
        const allCommits = fromCommit 
          ? [fromCommit, ...rangeCommitLog.all]
          : [...rangeCommitLog.all]
        
        return allCommits
      } catch (fallbackError) {
        throw fallbackError
      }
    }
    
    throw error
  }
}
