import { PromptTemplate } from '@langchain/core/prompts'

export const template = `As an experienced software engineer, you are tasked with performing a code review the changes in a git repository.

- Review the changes in the repository and provide feedback on the changes.
- Start with a top-down approach, examining high-level documentation, user stories, or commit messages to understand the purpose and context of the changes.
- Transition to a bottom-up approach by reviewing specific code segments, focusing on understanding small details and how they interact within the larger system.
- Apply control-flow and data-flow analysis to evaluate logical consistency and data integrity.
- Use cross-referencing to assess how changes impact the overall system and dependencies.

- Do not summarize the changes, but provide detailed feedback on what should be improved or changed.
- Breaking down the changes into categories and ranking by severity is helpful.
- Output the content in a clear and concise manner that will render well in a terminal or CLI.

{{format_instructions}}

Following the formatting instructions, perform a code review on the following changes

"""{{changes}}"""`

export const inputVariables = ['format_instructions', 'changes']

export const REVIEW_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
