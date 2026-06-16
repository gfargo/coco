import { TiktokenModel } from '@langchain/openai'
import { AnthropicModel, BedrockModel, GeminiModel, MistralModel } from './types'

export const OPEN_AI_MODELS = [
  'gpt-4.5',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4-32k',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3-mini',
  'o3',
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

export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
] as GeminiModel[]

export const MISTRAL_MODELS = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'codestral-latest',
  'ministral-8b-latest',
  'ministral-3b-latest',
  'open-mistral-nemo',
] as MistralModel[]

export const BEDROCK_MODELS = [
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'anthropic.claude-sonnet-4-20250514-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
  'meta.llama3-1-70b-instruct-v1:0',
  'mistral.mistral-large-2407-v1:0',
] as BedrockModel[]
