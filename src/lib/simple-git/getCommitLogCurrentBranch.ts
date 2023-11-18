import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'

export type GetCommitLogCurrentBranch = {
  git: SimpleGit
  logger?: Logger
  comparisonBranch?: string
}

export async function getCommitLogCurrentBranch({ git, logger, comparisonBranch = 'main' }: GetCommitLogCurrentBranch) : Promise<string[]> {
  try {
    // Get the current branch name
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);

    // Check if the current branch has any commits
    const hasCommits = (await git.raw(['rev-list', '--count', currentBranch])) !== '0';
    if (!hasCommits) {
      console.log('No commits on the current branch.');
      return [];
    }

    // Check for unique commits on the current branch
    const uniqueCommits = await git.raw(['rev-list', `${comparisonBranch}..${currentBranch}`]);

    return uniqueCommits.split('\n').filter(Boolean);
  } catch (error) {
    logger?.log('Encountered an error getting commit log from current branch', { color: 'red' })
  }

  return [];
}