import { PromptTemplate } from 'langchain/prompts'

const template = `GOAL: Use functional abstractions to summarize the following text

RULES: Avoid phrases like  "this change", "this code", or "this function" etc. Instead refer to the function, variable, or class by name.

TEXT:"""{text}"""
`

export const inputVariables = ['text']

export const SUMMARIZE_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})
