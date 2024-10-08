import { PromptTemplate } from '@langchain/core/prompts'

const template = `Write informative git changelog, in the imperative, based on a series of individual messages.

- Content should be formatted in Github-flavored markdown
- Include git commit hashes connected to each respective change
- Logically group changes, and if necessary, summarize dependency updates

{format_instructions}

"""{summary}"""`

export const inputVariables = ['format_instructions', 'summary']

export const CHANGELOG_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
