import { PromptTemplate } from '@langchain/core/prompts'

export const template = `Following the formatting instructions, summarize the following changes in the underlying git repository/branch.  
The summarization should descibe in a general sense what has changed in the repository over the specified timeframe.  Specific files can be mentioned, but the summary should be general enough to be useful to someone who has not seen the changes.

Breaking down the changes into categories (e.g. bug fixes, new features, etc.) with markdown headings is encouraged.

{timeframe}

{format_instructions}

"""{changes}"""`

export const inputVariables = ['format_instructions', 'changes', 'timeframe']

export const RECAP_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
