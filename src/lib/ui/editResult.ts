import { GenerateReviewLoopOptions } from './generateAndReviewLoop'
import { editorPrompt } from './inquirerPrompts'

export async function editResult(
  result: string,
  options: GenerateReviewLoopOptions
): Promise<string> {
  if (options.openInEditor) {
    return await editorPrompt({
      message: 'Edit the commit message',
      default: result,
      waitForUserInput: false,
      validate: (text) => (text ? true : 'Commit message cannot be empty'),
    })
  }

  return result
}
