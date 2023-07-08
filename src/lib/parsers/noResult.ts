import { getChanges } from '../simple-git/getChanges'
import { Logger } from '../utils/logger'
import { SimpleGit } from 'simple-git'

export const noResult = async ({ git, logger }: { git: SimpleGit; logger: Logger }) => {
  const { staged, unstaged, untracked } = await getChanges(git)

  if (staged.length > 0) {
    logger.log(`Staged files detected, but no summary generated...`, { color: 'red' })
    logger.log(
      `Files are likely either:\n  • changed files are ignored\n  • file diff is too large.`,
      { color: 'yellow' }
    )
  } else if (unstaged && unstaged.length > 0) {
    logger.log('No staged files detected, but unstaged files detected.', { color: 'yellow' })
    logger.verbose(
      `\n Unstaged Changes: \n ${unstaged.map(({ summary }) => summary).join('\n ')}`,
      {
        color: 'yellow',
      }
    )
  } else if (untracked && untracked.length > 0) {
    logger.log('No staged files detected, but untracked files detected.', { color: 'yellow' })
    logger.verbose(
      `\n Untracked Changes: \n ${untracked.map(({ summary }) => summary).join('\n ')}`,
      {
        color: 'yellow',
      }
    )
  } else {
    logger.log('No repo changes detected.', { color: 'yellow' })
  }

  process.exit(0)
}
