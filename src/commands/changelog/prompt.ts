import { PromptTemplate } from '@langchain/core/prompts'

const template = `Write informative git changelog, in the imperative, based on a series of individual messages.

- Annotate  each change with the git commit hash as reference, including just the first 7 characters
- Logically group changes, and if necessary, summarize dependency updates
- Include a descriptive title for the changelog, to give a high-level overview of the changes
- Depending on the size of the changes, consider breaking the changelog into sections
- Avoid generlizations like "various bug fixes" or "improvements" or "enhancements"

{format_instructions}

"""{summary}"""`

export const inputVariables = ['format_instructions', 'summary']

export const CHANGELOG_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
