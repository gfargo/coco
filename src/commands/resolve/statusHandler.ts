import chalk from 'chalk'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { commandExit } from '../../lib/utils/commandExit'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { ResolveArgv } from './config'

/**
 * `coco resolve status` — reports the in-progress git operation (merge,
 * rebase, cherry-pick, revert) and any conflicted files, then exits 1
 * when conflicts are present so it can gate CI/scripts. Pure git reads —
 * no LLM/remote calls.
 */
export const statusHandler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const operation = await getInProgressOperationType(git)
  const conflictedFiles = await getConflictedFiles(git)

  if (argv.json) {
    emitJson({ operation, conflictedFiles, count: conflictedFiles.length })
  } else if (conflictedFiles.length === 0 && operation === 'none') {
    logger.log('No operation in progress')
  } else {
    logger.log(`${chalk.bold('Operation:')} ${operation}`)
    logger.log(`${chalk.bold('Conflicted files:')} ${conflictedFiles.length}`)
    for (const file of conflictedFiles) {
      logger.log(`  ${chalk.yellow(`${file.indexStatus}${file.worktreeStatus}`)}\t${file.path}`)
    }
  }

  if (conflictedFiles.length > 0) {
    commandExit(1, 'conflicts present')
  }
}
