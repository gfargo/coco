import { PromptTemplate } from 'langchain/prompts'

const template = `Write informative git commit message, in the imperative, based on the diffs & file changes provided in the "Diff Summary" section.  
Commit Messages must have a short description that is less than 50 characters and a longer detailed summary no more than 300 characters, the shorter and more concise the better.  The detailed summary should be separated from the short description by a blank line.  Please follow the guidelines below when writing your commit message:

- Write concisely using an informal tone
- DO NOT use phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- DO NOT use specific names or files from the code
- DO NOT include any diffs or file changes in the commit message
- Wrap variable, class, function, components, and dependency names in back ticks e.g. \`variable\`
- ONLY respond with the resulting commit message.

"""{summary}"""

Commit:`

export const inputVariables = ['summary']

export const COMMIT_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
