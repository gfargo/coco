import { type OpenAIInput, type TiktokenModel } from '@langchain/openai'
import { type OllamaInput } from '@langchain/community/llms/ollama'
import { type BaseLLMParams } from '@langchain/core/language_models/llms'

export type LLMProvider = 'openai' | 'ollama'

export type OllamaModel =
  | 'neural-chat'
  | 'aya:8b'
  | 'aya:35b'
  | 'mistral'
  | 'llama2'
  | 'codellama'
  | 'codellama:7b'
  | 'codellama:13b'
  | 'codellama:34b'
  | 'codellama:70b'
  | 'llama2-uncensored'
  | 'llama2:13b'
  | 'llama2:70b'
  | 'llama3'
  | 'llama3:latest'
  | 'llama3:text'
  | 'llama3:70b'
  | 'llama3:70b-text'
  | 'orca2'
  | 'orca2:13b'
  | 'orca-mini'
  | 'orca-mini:latest'
  | 'orca-mini:13b'
  | 'orca-mini:70b'
  | 'phi3'
  | 'phi3:mini'
  | 'phi3:medium'
  | 'phi3:medium-128k'
  | 'qwen2'
  | 'qwen2:72b'
  | 'qwen2:72b-text'
  | 'qwen2:1.5b'
  | 'qwen2:0.5b'
  | 'gemma'
  | 'gemma:7b`'
  | 'gemma:2b'
  | 'codegemma'
  | 'codegemma:7b-code'
  | 'codegemma:2b'

export type LLMModel = TiktokenModel | OllamaModel

export type BaseLLMService = {
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
  authentication: Authentication
  requestOptions?: {
    timeout?: number
    maxRetries?: number
  }
  fields?: OpenAIFields | OllamaFields
}

type Authentication =
  | {
      type: 'None'
      credentials: undefined
    }
  | {
      type: 'OAuth'
      credentials: {
        clientId?: string
        clientSecret?: string
        token?: string
      }
    }
  | {
      type: 'APIKey'
      credentials: {
        apiKey: string
      }
    }

type OpenAIFields = Partial<OpenAIInput> & BaseLLMParams
type OllamaFields = Partial<OllamaInput> & BaseLLMParams

export type OpenAILLMService = BaseLLMService & {
  provider: 'openai'
  model: TiktokenModel
  fields?: OpenAIFields
}

export type OllamaLLMService = BaseLLMService & {
  provider: 'ollama'
  model: OllamaModel
  endpoint: string
  fields?: OllamaFields
}

export type LLMService = OpenAILLMService | OllamaLLMService