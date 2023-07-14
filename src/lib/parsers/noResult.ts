import { getChanges } from '../simple-git/getChanges'
import { Logger } from '../utils/logger'
import { SimpleGit } from 'simple-git'

export const noResult = async ({ git, logger }: { git: SimpleGit; logger: Logger }) => {
  const { staged, unstaged, untracked } = await getChanges(git)
  const hasStaged = staged && staged.length > 0
  const hasUnstaged = unstaged && unstaged.length > 0
  const hasUntracked = untracked && untracked.length > 0

  if (hasStaged) {
    logger.log(`Staged files detected, but no summary generated...`, { color: 'red' })
    logger.log(
      `Files are likely either:\n  • changed files are ignored\n  • file diff is too large.`,
      { color: 'yellow' }
    )
  } else if (hasUnstaged || hasUntracked) {
    logger.log('Forget something? No staged changes found... 👻', { color: 'red' })
    
    if (hasUnstaged) {
      logger.log('\nDetected unstaged changes', { color: 'yellow' })
      logger.verbose(
        `\t${unstaged.map(({ summary }) => summary).join('\n\t')}`,
        {
          color: 'red',
        }
      )
    }

    if (hasUntracked) {
      logger.log('\nDetected untracked changes', { color: 'yellow' })
      logger.verbose(
        `\t${untracked.map(({ summary }) => summary).join('\n\t')}`,
        {
          color: 'red',
        }
      )
    }
  } else {
    logger.log('No repo changes detected. 👀', { color: 'blue' })
  }
}
