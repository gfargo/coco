import { PromptTemplate } from '@langchain/core/prompts'

/**
 * Template for generating git commit messages based on code changes
 * 
 * Variables:
 * - summary: Contains the diff summary of staged changes
 * - format_instructions: Instructions for the output format (JSON with title and body)
 * - additional_context: Optional user-provided context to guide the commit message generation
 * - commit_history: Optional history of previous commits for context
 */
export const template = `Write informative git commit message, in the imperative, based on the diffs & file changes provided in the "Diff Summary" section.
Commit Messages must have a short description that is less than 50 characters and a longer detailed summary around 300 characters, the shorter and more concise the better.

Please follow the guidelines below when writing your commit message:

- Write concisely using an informal tone
- Avoid phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- Avoid referencing specific files names or long paths in the commit message
- DO NOT include any diffs or file changes in the commit message
- Wrap variable, class, function, components, and dependency names in back ticks e.g. \`variable\`

{format_instructions}

{commit_history}

""""""
{summary}
""""""

{additional_context}
`

// Define the variables that will be passed to the prompt template
const inputVariables = ['summary', 'format_instructions', 'additional_context', 'commit_history']

export const COMMIT_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
