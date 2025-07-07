import { TiktokenModel } from '@langchain/openai'
import { AnthropicModel } from './types'

export const OPEN_AI_MODELS = [
  'gpt-4.5',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4-32k',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  '03-mini',
  '03',
  'o4-mini',
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
