import { PromptTemplate } from '@langchain/core/prompts'

export const template = `You are a senior engineer doing code archaeology. For each commit listed below, explain WHY the lines it introduced in {{file}} were most likely written — the intent behind the change — not a restatement of the commit message.

Keep each explanation to 1-3 sentences, grounded in the commit's subject/body and the line range it touches. If the intent genuinely can't be inferred, say so briefly instead of guessing.

{{format_instructions}}

{{language_context}}

"""{{commits}}"""`

export const inputVariables = ['file', 'format_instructions', 'commits', 'language_context']

export const BLAME_EXPLAIN_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
