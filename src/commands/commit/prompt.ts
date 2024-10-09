import { PromptTemplate } from '@langchain/core/prompts'

export const template = `Write informative git commit message, in the imperative, based on the diffs & file changes provided in the "Diff Summary" section.  
Commit Messages must have a short description that is less than 50 characters and a longer detailed summary around 300 characters, the shorter and more concise the better. 

Please follow the guidelines below when writing your commit message:

- Write concisely using an informal tone
- Avoid phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- Avoid referencing specific files names or long paths in the commit message
- DO NOT include any diffs or file changes in the commit message
- Wrap variable, class, function, components, and dependency names in back ticks e.g. \`variable\`

{format_instructions}

"""{summary}"""`

export const inputVariables = ['summary', 'format_instructions']

export const COMMIT_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
