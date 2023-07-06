import { HuggingFaceInference } from 'langchain/llms/hf'
import { PromptTemplate } from 'langchain/prompts'
import { SummarizationChainParams, loadSummarizationChain } from 'langchain/chains'
import { BaseLLMParams } from 'langchain/llms/base'
import { AzureOpenAIInput, OpenAIInput, OpenAI } from 'langchain/llms/openai'
import {
  RecursiveCharacterTextSplitter,
  RecursiveCharacterTextSplitterParams,
} from 'langchain/text_splitter'
import { ConfigurationParameters } from 'openai'

// TODO: Extend this to support other models! 🎉
export function getModel(
  fields?:
    | (Partial<OpenAIInput> &
        Partial<AzureOpenAIInput> &
        BaseLLMParams & {
          configuration?: ConfigurationParameters | undefined
        })
    | undefined,
  configuration?: ConfigurationParameters | undefined
): OpenAI | HuggingFaceInference {
  return new OpenAI(fields, configuration)
  // return new HuggingFaceInference({
  //   // model: 'gpt2',
  //   // model: 'bigcode/starcoder',
  //   model: 'bigscience/bloom',
  //   apiKey: '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',
  //   maxConcurrency: 4,
  //   cache: true,
  //   // maxTokens: 2046,
  // })
}

export function getTextSplitter(
  options: Partial<RecursiveCharacterTextSplitterParams> = {}
): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter(options)
}

export function getChain(
  model: ReturnType<typeof getModel>,
  options: SummarizationChainParams = { type: 'map_reduce' }
) {
  return loadSummarizationChain(model, options)
}

type CreatePromptInput = {
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
        })
      : fallback
  ) as PromptTemplate
}

export function validatePromptTemplate(text: string, inputVariables: string[]) {
  if (!text) {
    return 'Prompt template cannot be empty'
  }

  if (!inputVariables.some((entry) => text.includes(entry))) {
    return (
      'Prompt template must include at least one of the following input variables: ' +
      inputVariables.map((value) => `{${value}}`).join(', ')
    )
  }
  return true
}
