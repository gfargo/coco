import { editor } from '@inquirer/prompts'
import { GenerateReviewLoopOptions } from './generateAndReviewLoop'
import { COMMIT_PROMPT } from '../langchain/prompts/commitDefault'
import { validatePromptTemplate } from '../langchain/utils'

export async function editPrompt(options: GenerateReviewLoopOptions): Promise<string> {
  return await editor({
    message: 'Edit the prompt',
    default: options.prompt?.length ? options.prompt : COMMIT_PROMPT.template,
    waitForUseInput: false,
    validate: (text) => validatePromptTemplate(text, COMMIT_PROMPT.inputVariables),
  })
}
