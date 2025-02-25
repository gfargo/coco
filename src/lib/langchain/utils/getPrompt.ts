import { PromptTemplate } from '@langchain/core/prompts'

export type CreatePromptInput = {
  template?: string
  variables: string[]
  fallback?: PromptTemplate
}

export function getPrompt({ template, variables, fallback }: CreatePromptInput) {
  if (!template && !fallback) throw new Error('Must provide either a template or a fallback')

  return (
    template
      ? new PromptTemplate({
          template,
          inputVariables: variables,
          templateFormat: 'mustache',
        })
      : fallback
  ) as PromptTemplate
}
