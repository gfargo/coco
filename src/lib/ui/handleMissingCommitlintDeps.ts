import { select } from '@inquirer/prompts'
import { Logger } from '../utils/logger'

export interface MissingDependencyOptions {
  logger: Logger
  interactive: boolean
  missingPackages: string[]
}

export type MissingDependencyAction = 'continue' | 'abort' | 'setup'

export interface MissingDependencyResult {
  action: MissingDependencyAction
}

/**
 * Handle missing commitlint dependencies with user-friendly options
 */
export async function handleMissingCommitlintDeps(
  options: MissingDependencyOptions
): Promise<MissingDependencyResult> {
  const { logger, interactive, missingPackages } = options

  if (!interactive) {
    logger.log('\nCommitlint packages not found. Skipping commit message validation.', {
      color: 'yellow',
    })
    logger.log('Run `coco init` to set up commitlint for conventional commits.', {
      color: 'gray',
    })
    return { action: 'continue' }
  }

  logger.log('\nCommitlint configuration requires additional packages:', { color: 'yellow' })
  missingPackages.forEach((pkg) => {
    logger.log(`  • ${pkg}`, { color: 'gray' })
  })
  logger.log('')

  const choice = await select({
    message: 'How would you like to proceed?',
    choices: [
      {
        name: 'Continue without commitlint validation',
        value: 'continue' as MissingDependencyAction,
        description: 'Generate commit message without validation rules',
      },
      {
        name: 'Set up commitlint (run coco init)',
        value: 'setup' as MissingDependencyAction,
        description: 'Exit and run the init command to install required packages',
      },
      {
        name: 'Abort',
        value: 'abort' as MissingDependencyAction,
        description: 'Cancel the commit operation',
      },
    ],
    default: 'continue' as MissingDependencyAction,
  })

  return { action: choice }
}