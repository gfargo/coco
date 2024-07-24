import { PromptTemplate } from '@langchain/core/prompts'

const template = `Write informative git changelog, in the imperative, based on a series of individual messages.

- Typically a hyphen or asterisk is used for the bullet
- Summarize dependency updates

"""{summary}"""

Changelog:`

export const inputVariables = ['summary']

export const CHANGELOG_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
