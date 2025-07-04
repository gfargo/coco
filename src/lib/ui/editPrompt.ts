import { editor } from '@inquirer/prompts'
import { COMMIT_PROMPT } from '../../commands/commit/prompt'
import { validatePromptTemplate } from '../langchain/utils/validatePromptTemplate'
import { GenerateReviewLoopOptions } from './generateAndReviewLoop'

export async function editPrompt(options: GenerateReviewLoopOptions): Promise<string> {
  return await editor({
    message: 'Edit the prompt',
    default: options.prompt?.length ? options.prompt : COMMIT_PROMPT.template as string,
    waitForUseInput: false,
    postfix: 'Press ENTER to continue',
    validate: (text) => {
      try {
        validatePromptTemplate(text, COMMIT_PROMPT.inputVariables)
        return true
      } catch (error) {
        return error instanceof Error ? error.message : 'Invalid prompt template'
      }
    },
  })
}
