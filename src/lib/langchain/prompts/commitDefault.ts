import { PromptTemplate } from 'langchain/prompts'

const template = `Write informative git commit message, in the imperative, based on the diffs & file changes provided in the "Diff Summary" section.  
Commit Messages must have a short description that is less than 50 characters followed by a newline character and then a more verbose detailed description.

- Typically a hyphen or asterisk is used for the bullet
- Write concisely using an informal tone
- DO NOT use phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- DO NOT use phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- DO NOT use specific names or files from the code
- Wrap variable, class, function, components, and dependency names in back ticks e.g. \`variable\`

"""{summary}"""

Commit:`

export const inputVariables = ['summary']

export const COMMIT_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
