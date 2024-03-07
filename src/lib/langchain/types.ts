import { OpenAIInput, TiktokenModel } from 'langchain/dist/types/openai-types'
import { OllamaInput } from 'langchain/dist/util/ollama'
import { BaseLLMParams } from 'langchain/llms/base'

export type LLMProvider = 'openai' | 'ollama'

export type OllamaModel =
  | 'neural-chat'
  | 'starling-lm'
  | 'mistral'
  | 'llama2'
  | 'codellama'
  | 'llama2-uncensored'
  | 'llama2:13b'
  | 'llama2:70b'
  | 'orca-mini'
  | 'vicuna'

export type LLMModel = TiktokenModel | OllamaModel

export interface BaseLLMService {
  provider: LLMProvider
  model: LLMModel
  /**
   * The maximum number of tokens per request.
   *
   * @default 1024
   */
  tokenLimit?: number
  /**
   * The temperature value controls the randomness of the generated output.
   * Higher values (e.g., 0.8) make the output more random, while lower values (e.g., 0.2) make it more deterministic.
   *
   * @default 0.4
   */
  temperature?: number
  /**
   * The maximum number of requests to make concurrently.
   *
   * @default 6
   */
  maxConcurrent?: number
  authentication: {
    type: 'APIKey' | 'OAuth' | 'None'
    credentials?: {
      apiKey?: string
      clientId?: string
      clientSecret?: string
      token?: string
    }
  }
  requestOptions?: {
    timeout?: number
    maxRetries?: number
  }
  fields?: OpenAIFields | OllamaFields
}

type OpenAIFields = Partial<OpenAIInput> & BaseLLMParams
type OllamaFields = Partial<OllamaInput> & BaseLLMParams

export interface OpenAILLMService extends BaseLLMService {
  provider: 'openai'
  model: TiktokenModel
  fields?: OpenAIFields
}

export interface OllamaLLMService extends BaseLLMService {
  provider: 'ollama'
  model: OllamaModel
  endpoint: string
  fields?: OllamaFields
}

export type LLMService = OpenAILLMService | OllamaLLMService
export type LLMServiceAlias = 'openai' | 'ollama'