import { OllamaLLMService, OpenAILLMService } from "./types"

export const DEFAULT_OLLAMA_LLM_SERVICE = {
  provider: 'ollama',
  model: 'llama3',
  endpoint: 'http://localhost:11434',
  maxConcurrent: 1,
  tokenLimit: 1024,
} as OllamaLLMService

export const DEFAULT_OPENAI_LLM_SERVICE = {
  provider: 'openai',
  model: 'gpt-4',
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
  tokenLimit: 1024,
} as OpenAILLMService