import { editor } from '@inquirer/prompts'
import { GenerateReviewLoopOptions } from './generateAndReviewLoop'

export async function editResult(
  result: string,
  options: GenerateReviewLoopOptions
): Promise<string> {
  if (options.openInEditor) {
    return await editor({
      message: 'Edit the commit message',
      default: result,
      waitForUseInput: false,
      validate: (text) => (text ? true : 'Commit message cannot be empty'),
    })
  }

  return result
}
