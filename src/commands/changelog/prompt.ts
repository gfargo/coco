import { PromptTemplate } from '@langchain/core/prompts'

const template = `Write informative git changelog, in the imperative, based on a series of individual messages.

- Include the git commit hash as reference for each change, including just the first 7 characters
- Logically group changes, and if necessary, summarize dependency updates

{format_instructions}

"""{summary}"""`

export const inputVariables = ['format_instructions', 'summary']

export const CHANGELOG_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
