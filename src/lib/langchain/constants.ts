import { TiktokenModel } from '@langchain/openai'
import { AnthropicModel } from './types'

export const OPEN_AI_MODELS = [
  'gpt-4o',
  'gpt-4-32k',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
] as TiktokenModel[]

export const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet-20240620',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
  'claude-2.1',
  'claude-2.0',
] as AnthropicModel[]
