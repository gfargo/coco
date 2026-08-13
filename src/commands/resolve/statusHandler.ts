import chalk from 'chalk'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { commandExit } from '../../lib/utils/commandExit'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { ResolveArgv } from './config'

/**
 * `coco resolve status` — reports the in-progress git operation (merge,
 * rebase, cherry-pick, revert, or none) and the currently conflicted files,
 * without proposing or applying any resolutions.
 */
export const statusHandler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  const operation = await getInProgressOperationType(git)
  const conflictedFiles = await getConflictedFiles(git)

  if (argv.json) {
    emitJson({
      operation,
      conflictedFiles: conflictedFiles.map((file) => ({
        path: file.path,
        indexStatus: file.indexStatus,
        worktreeStatus: file.worktreeStatus,
      })),
      count: conflictedFiles.length,
    })
  } else {
    logger.log(`${chalk.bold('Operation:')} ${operation}`)
    logger.log(`${chalk.bold('Conflicted files:')} ${conflictedFiles.length}`)
    for (const file of conflictedFiles) {
      logger.log(`  ${chalk.red(`${file.indexStatus}${file.worktreeStatus}`)} ${file.path}`)
    }
  }

  if (conflictedFiles.length > 0) {
    commandExit(1, `resolve status: ${conflictedFiles.length} conflicted file(s)`)
  }
}
