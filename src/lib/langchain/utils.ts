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
import { BaseCommandOptions } from '../../types'

/**
 * Get LLM Model Based on Configuration
 *
 * @param fields
 * @param configuration
 * @returns LLM Model
 */
export function getModel(
  name: string,
  key: string,
  fields?:
    | (Partial<OpenAIInput> &
        Partial<AzureOpenAIInput> &
        BaseLLMParams & {
          configuration?: ConfigurationParameters | undefined
        })
    | undefined,
  configuration?: ConfigurationParameters | undefined
): OpenAI | HuggingFaceInference {
  const [llm, model] = name.split(/\/(.*)/s)

  if (!model) {
    throw new Error(`Invalid model: ${name}`)
  }

  switch (llm) {
    case 'huggingface':
      return new HuggingFaceInference({
        model: model,
        apiKey: key,
        maxConcurrency: 4,
        ...fields,
      })
    case 'openai':
    default:
      return new OpenAI(
        {
          openAIApiKey: key,
          modelName: model,
          ...fields,
        },
        configuration
      )
  }
}

export function getModelAPIKey(
  name: string,
  options: BaseCommandOptions
) {
  const [llm, model] = name.split(/\/(.*)/s)

  if (!model) {
    throw new Error(`Invalid model: ${name}`)
  }

  switch (llm) {
    case 'huggingface':
      return options.huggingFaceHubApiKey
    case 'openai':
    default:
      return options.openAIApiKey
  }
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
