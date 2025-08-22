import { PromptTemplate } from '@langchain/core/prompts'

const template = `You are a highly skilled software engineer tasked with writing a git changelog. Your response should be informative, well-structured, and in the imperative.

## Input
You will be provided with a summary of changes. This summary can be one of the following:
1. A list of commits, each with its author, hash, message, and body.
2. A list of commits, each with its details AND the full diff of the changes.
3. A single, comprehensive diff for an entire branch.

## Rules
- Create a descriptive title for the changelog that gives a high-level overview of the changes.
- **BREAKING CHANGES**: Identify any commits that introduce breaking changes. These must be listed first under a "### 💥 BREAKING CHANGES" heading.
- **Grouping**: Logically group related changes under descriptive headings (e.g., ### Features, ### Fixes, ### Refactors).
- **Dependencies**: Group all dependency updates (e.g., changes to package.json, go.mod) under a "### Dependencies" section.
- **Summaries**: For each change, provide a concise summary.
- **Attribution**: {{author_instructions}}
- **Technical Details**: If provided with diffs, use them to understand the technical details and provide a more accurate and detailed description of the changes.
- **Clarity**: Avoid generalizations like "various bug fixes," "improvements," or "enhancements." Be specific.
- **Formatting**: Your entire response must be valid Markdown.

## Formatting Instructions
{{format_instructions}}

{{additional_context}}

"""{{summary}}"""`

export const inputVariables = [
  'format_instructions',
  'summary',
  'additional_context',
  'author_instructions',
]

export const CHANGELOG_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
