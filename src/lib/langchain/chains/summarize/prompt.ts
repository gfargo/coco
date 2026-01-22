import { PromptTemplate } from '@langchain/core/prompts'

/**
 * Prompt template for summarizing code diffs.
 *
 * TODO: Future improvements to consider:
 * - Separate prompts for file-level vs directory-level summarization
 * - Include file type context (e.g., "This is a React component", "This is a test file")
 * - Add guidance for preserving semantic meaning of changes
 * - Consider change type (added/modified/deleted) in prompt for better context
 * - Include hints about the programming language for more idiomatic summaries
 * - Add support for custom user-provided summarization prompts via config
 */
const template = `GOAL: Use functional abstractions to summarize the following text

RULES: Avoid phrases like  "this change", "this code", or "this function" etc. Instead refer to the function, variable, or class by name.

TEXT:"""{text}"""
`

export const inputVariables = ['text']

export const SUMMARIZE_PROMPT = new PromptTemplate({
  inputVariables,
  template,
})
