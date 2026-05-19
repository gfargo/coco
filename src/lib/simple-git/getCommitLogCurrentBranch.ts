import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCommitLogRangeDetails, CommitDetails } from './getCommitLogRangeDetails'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetCommitLogCurrentBranch = {
  git: SimpleGit
  logger?: Logger
  comparisonBranch?: string
  comparisonRemote?: string
}

async function refExists(git: SimpleGit, ref: string): Promise<boolean> {
  try {
    // `--verify --quiet` suppresses stderr noise on a missing ref and
    // emits the resolved sha on stdout when it exists. simple-git
    // returns an empty string (rather than throwing) when git exits
    // 1 under `--quiet`, so the presence/absence check is on the
    // output, not on whether the call rejected.
    const out = await git.raw(['rev-parse', '--verify', '--quiet', ref])
    return out.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Retrieves the commit log for the current branch.
 *
 * Edge states that are not errors and should not be reported as such:
 *
 *   - Detached HEAD (including mid-rebase and mid-bisect, which both
 *     leave HEAD detached). There is no "current branch" to compare
 *     against; the helper logs a yellow status line and returns [].
 *   - Comparison ref missing — e.g. the repo has no `origin` remote,
 *     so `origin/main` does not resolve; or the local comparison
 *     branch (`main`) simply does not exist. Previously this threw
 *     and surfaced as a red "Encountered an error" banner. Now we
 *     probe the ref up front and report a clean status line.
 *   - Empty rev-list output. The previous yellow "Unable to determine
 *     first and last commit" wording read like an error; it's just
 *     "no commits ahead of the comparison ref", which is the normal
 *     outcome when the branch is at or behind its baseline.
 *
 * The catch block is reserved for genuinely unexpected git failures.
 *
 * @param {Object} options - The options for retrieving the commit log.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} [options.comparisonBranch='main'] - The branch to compare against.
 * @param {string} [options.comparisonRemote='origin'] - The remote to compare against.
 * @returns {Promise<CommitDetails[]>} The array of commit messages in the commit log.
 */
export async function getCommitLogCurrentBranch({
  git,
  logger,
  comparisonBranch = 'main',
  comparisonRemote = 'origin',
}: GetCommitLogCurrentBranch): Promise<CommitDetails[]> {
  const branchName = await getCurrentBranchName({ git })

  // Detached HEAD: `git rev-parse --abbrev-ref HEAD` returns the literal
  // string 'HEAD' in this state. Also covers mid-rebase and mid-bisect,
  // which both detach HEAD onto the picked / midpoint commit. There's
  // no branch to compare against, so don't pretend there was an error.
  if (!branchName || branchName === 'HEAD') {
    logger?.log(
      'HEAD is detached (or a rebase / bisect is in progress) — no branch context to compare against.',
      { color: 'yellow' }
    )
    return []
  }

  try {
    let comparisonRef: string
    if (comparisonBranch === branchName) {
      // Same branch as the comparison target — compare against the
      // remote-tracking ref. If the remote (or the ref) does not
      // exist, fall back to a clean status line rather than throwing.
      const remoteRef = `${comparisonRemote}/${comparisonBranch}`
      if (!(await refExists(git, remoteRef))) {
        logger?.log(
          `No "${remoteRef}" ref to compare against — skipping changelog for "${branchName}".`,
          { color: 'yellow' }
        )
        return []
      }
      comparisonRef = remoteRef
    } else {
      if (!(await refExists(git, comparisonBranch))) {
        logger?.log(
          `Comparison branch "${comparisonBranch}" does not exist — skipping changelog for "${branchName}".`,
          { color: 'yellow' }
        )
        return []
      }
      comparisonRef = comparisonBranch
    }

    const uniqueCommits = (await git.raw(['rev-list', `${comparisonRef}..${branchName}`]))
      .split('\n')
      .filter(Boolean)
      .reverse()

    logger?.verbose(
      `Found ${uniqueCommits.length} unique commits on "${branchName}" vs "${comparisonRef}"`,
      { color: 'blue' }
    )

    const firstCommit = uniqueCommits[0]
    const lastCommit = uniqueCommits[uniqueCommits.length - 1]

    if (!firstCommit || !lastCommit) {
      // Empty rev-list output is the normal outcome when the branch is
      // at or behind its baseline. Not an error.
      logger?.log(`No commits on "${branchName}" ahead of "${comparisonRef}".`)
      return []
    }

    return await getCommitLogRangeDetails(firstCommit, lastCommit, { git, noMerges: true })
  } catch (error) {
    logger?.log('Encountered an error getting commit log from current branch', { color: 'red' })
    logger?.verbose(error instanceof Error ? error.message : String(error), { color: 'red' })
  }

  return []
}
