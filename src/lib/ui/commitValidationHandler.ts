import { select } from '@inquirer/prompts'
import { ValidationResult } from '../utils/commitlintValidator'
import { Logger } from '../utils/logger'
import { editResult } from './editResult'

export interface ValidationHandlerOptions {
  logger: Logger
  interactive: boolean
  openInEditor?: boolean
}

export interface ValidationHandlerResult {
  message: string
  action: 'proceed' | 'edit' | 'regenerate' | 'abort'
}

/**
 * Handle commit message validation results with user interaction
 */
export async function handleValidationErrors(
  message: string,
  validationResult: ValidationResult,
  options: ValidationHandlerOptions
): Promise<ValidationHandlerResult> {
  const { logger, interactive } = options

  // If validation passed, return original message
  if (validationResult.valid) {
    return { message, action: 'proceed' }
  }

  // Display validation errors and warnings
  logger.log('\nCommit message validation failed:', { color: 'yellow' })

  if (validationResult.errors.length > 0) {
    logger.log('\nErrors:', { color: 'red' })
    validationResult.errors.forEach((error) => {
      logger.log(`  • ${error}`, { color: 'red' })
    })
  }

  if (validationResult.warnings.length > 0) {
    logger.log('\nWarnings:', { color: 'yellow' })
    validationResult.warnings.forEach((warning) => {
      logger.log(`  • ${warning}`, { color: 'yellow' })
    })
  }

  // In non-interactive mode, just return with abort action
  if (!interactive) {
    return { message, action: 'abort' }
  }

  // In interactive mode, offer options to the user
  const choice = await select({
    message: 'How would you like to proceed?:',
    choices: [
      {
        name: 'Try 2 more attempts',
        value: 'retry',
        description: 'Let the AI try generating 2 more commit messages with error feedback',
      },
      {
        name: 'Edit manually',
        value: 'edit',
        description: 'Edit the commit message manually to fix the issues',
      },
      {
        name: 'Abort',
        value: 'abort',
        description: 'Abort the commit process',
      },

    ],
  })

  switch (choice) {
    case 'edit': {
      // Edit message manually
      const editedMessage = await editResult(message, options)
      return { message: editedMessage, action: 'edit' }
    }
    case 'retry':
      // Regenerate message
      return { message, action: 'regenerate' }
    default:
      // Abort
      return { message, action: 'abort' }
  }
}
