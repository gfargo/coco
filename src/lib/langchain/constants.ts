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
  'claude-sonnet-4-0',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
] as AnthropicModel[]
