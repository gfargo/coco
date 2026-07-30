import { PromptTemplate } from '@langchain/core/prompts'

export const template = `As an experienced software engineer, rewrite the subject line of an existing git commit so it conforms to the project's commit message rules, while preserving the original commit's meaning and scope. Do not invent details that aren't implied by the original subject or body.

{{commitlint_rules_context}}

Original subject: "{{subject}}"

Original body:
"""{{body}}"""

Validation errors to fix:
{{errors}}

{{language_context}}

{{format_instructions}}`

export const inputVariables = [
  'subject',
  'body',
  'errors',
  'commitlint_rules_context',
  'language_context',
  'format_instructions',
]

export const REWORD_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
