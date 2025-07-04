import { type OllamaInput } from '@langchain/community/llms/ollama'
import { type BaseLLMParams } from '@langchain/core/language_models/llms'
import { type OpenAIInput, type TiktokenModel } from '@langchain/openai'

export type LLMProvider = 'openai' | 'ollama' | 'anthropic'

export type AnthropicModel =
  | 'claude-sonnet-4-0'
  | 'claude-3-7-sonnet-latest'
  | 'claude-3-5-haiku-latest'
  | 'claude-3-5-sonnet-latest'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-sonnet-20240620'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'

export type OllamaModel =
  | 'deepseek-r1:1.5b'
  | 'deepseek-r1:8b'
  | 'deepseek-r1:32b'
  | 'codegemma:2b'
  | 'codegemma:7b-code'
  | 'codegemma'
  | 'codellama:13b'
  | 'codellama:34b'
  | 'codellama:70b'
  | 'codellama:7b'
  | 'codellama:instruct'
  | 'codellama:latest'
  | 'codellama'
  | 'gemma:2b'
  | 'gemma:7b'
  | 'gemma:latest'
  | 'gemma'
  | 'llama2:13b'
  | 'llama2:70b'
  | 'llama2:chat'
  | 'llama2:latest'
  | 'llama2:text'
  | 'llama2'
  | 'llama3:70b-text'
  | 'llama3:70b'
  | 'llama3:latest'
  | 'llama3:text'
  | 'llama3.1:70b'
  | 'llama3.1:8b'
  | 'llama3.1:latest'
  | 'llama3.2'
  | 'llama3.2:latest'
  | 'llama3.2:1b'
  | 'llama3.2:3b'
  | 'llama3'
  | 'llava-llama3:latest'
  | 'dolphin-llama3:latest'
  | 'dolphin-llama3:8b'
  | 'dolphin-llama3:70b'
  // UNTESTED
  | 'mistral:7b'
  | 'mistral:latest'
  | 'mistral:text'
  | 'mistral'
  | 'phi3:14b'
  | 'phi3:3.8b'
  | 'phi3:instruct'
  | 'phi3:medium-128k'
  | 'phi3:medium-4k'
  | 'phi3:medium'
  | 'phi3'
  | 'qwen2:0.5b'
  | 'qwen2:1.5b'
  | 'qwen2:72b-text'
  | 'qwen2:72b'
  | 'qwen2'
  | 'qwen2.5-coder:latest'
  | 'qwen2.5-coder:0.5b'
  | 'qwen2.5-coder:1.5b'
  | 'qwen2.5-coder:3b'
  | 'qwen2.5-coder:7b'
  | 'qwen2.5-coder:14b'
  | 'qwen2.5-coder:32b'

export type LLMModel = TiktokenModel | OllamaModel | AnthropicModel

export type BaseLLMService = {
  provider: LLMProvider
  model: LLMModel
  /**
   * The maximum number of tokens per request.
   *
   * @default 2048
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
  /**
   * The maximum number of attempts for schema parsing with retry logic.
   *
   * @default 3
   */
  maxParsingAttempts?: number
}

export type AnthropicLLMService = BaseLLMService & {
  provider: 'anthropic'
  model: AnthropicModel
  fields?: {
    temperature?: number
    maxTokens?: number
  }
}

export type LLMService = OpenAILLMService | OllamaLLMService | AnthropicLLMService
