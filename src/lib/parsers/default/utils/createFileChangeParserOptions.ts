import { SimpleGit } from 'simple-git'
import { BaseParserOptions } from '../../../types'
import { LLMProvider } from '../../../langchain/types'
import { Logger } from '../../../utils/logger'
import { TokenCounter } from '../../../utils/tokenizer'
import { getLlm } from '../../../langchain/utils/getLlm'

export type FileChangeParserServiceBudget = {
  tokenLimit?: number
  minTokensForSummary?: number
  maxFileTokens?: number
  maxConcurrent?: number
  fastPath?: {
    markdown?: boolean
    languageAware?: {
      enabled?: boolean
      languages?: ('ts' | 'js' | 'py' | 'rs' | 'go')[]
    }
  }
}

export type CreateFileChangeParserOptionsInput = {
  command: string
  git: SimpleGit
  llm: ReturnType<typeof getLlm>
  logger: Logger
  model: string
  provider: LLMProvider | string
  service?: FileChangeParserServiceBudget
  tokenizer: TokenCounter
}

export function createFileChangeParserOptions({
  command,
  git,
  llm,
  logger,
  model,
  provider,
  service,
  tokenizer,
}: CreateFileChangeParserOptionsInput): BaseParserOptions {
  return {
    tokenizer,
    git,
    llm,
    logger,
    maxTokens: service?.tokenLimit,
    minTokensForSummary: service?.minTokensForSummary,
    maxFileTokens: service?.maxFileTokens,
    maxConcurrent: service?.maxConcurrent,
    fastPath: service?.fastPath,
    metadata: {
      command,
      provider,
      model,
    },
  }
}
