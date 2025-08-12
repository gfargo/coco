import { editResult } from './editResult'
import { GenerateReviewLoopOptions } from './generateAndReviewLoop'

/**
 * Edit a commit message with commitlint validation if config exists
 */
export async function editCommitMessage(
  message: string,
  options: GenerateReviewLoopOptions
): Promise<string> {
  // First, let the user edit the message
  const editedMessage = await editResult(message, options)
  
  // Then validate it against commitlint if config exists
  const { hasCommitlintConfig } = await import('../utils/hasCommitlintConfig')
  const hasConfig = await hasCommitlintConfig()
  
  if (hasConfig) {
    const { validateCommitMessage } = await import('../utils/commitlintValidator')
    const { handleValidationErrors } = await import('./commitValidationHandler')
    
    const validationResult = await validateCommitMessage(editedMessage)
    
    if (!validationResult.valid) {
      // Show validation errors and get user action
      const validationHandlerResult = await handleValidationErrors(
        editedMessage,
        validationResult,
        {
          logger: options.logger,
          interactive: options.interactive,
          openInEditor: options.openInEditor,
        }
      )
      
      // Return the result from the validation handler
      return validationHandlerResult.message
    }
  }
  
  return editedMessage
}