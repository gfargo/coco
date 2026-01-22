import { SimpleGit } from 'simple-git'
import { getLlm } from './langchain/utils/getLlm'
import { Logger } from './utils/logger'
import { TokenCounter } from './utils/tokenizer'

export type FileChangeStatus =
  | 'modified'
  | 'renamed'
  | 'added'
  | 'deleted'
  | 'untracked'
  | 'unknown'

export interface FileChange {
  summary: string
  filePath: string
  oldFilePath?: string
  status: FileChangeStatus
}

export interface GetChangesResult {
  /** Changes that have been staged (added to the index). */
  staged: FileChange[]
  /** Changes in the working directory that are not yet staged. */
  unstaged: FileChange[]
  /** Files that are not tracked by Git. */
  untracked: FileChange[]
}

export interface FileDiff {
  file: string
  diff: string
  summary: string
  tokenCount: number
}
export interface DiffNode {
  path: string
  diffs: FileDiff[]
  children: DiffNode[]
}

export interface DirectoryDiff {
  path: string
  diffs: FileDiff[]
  summary?: string
  tokenCount: number
}

export interface BaseParserOptions {
  tokenizer: TokenCounter
  llm: ReturnType<typeof getLlm>
  git: SimpleGit
  logger: Logger
  maxTokens?: number
  /**
   * Minimum token count for a directory/file group to be eligible for summarization.
   * @default 400
   */
  minTokensForSummary?: number
  /**
   * Maximum tokens allowed for a single file diff before it gets pre-summarized.
   * Defaults to 25% of maxTokens if not specified.
   */
  maxFileTokens?: number
  /**
   * Maximum number of concurrent summarization requests.
   * @default 6
   */
  maxConcurrent?: number
}

export interface BaseParserInput {
  options: BaseParserOptions
}

export interface FileChangeParserInput extends BaseParserInput {
  changes: FileChange[]
  commit: '--staged' | '--unstaged' | '--untracked' | string
}

export interface CommitLogParserInput extends BaseParserInput {
  range: {
    from: string
    to: string
  }
}

export type CommandHandler<T> = (argv: T, logger: Logger) => Promise<void>;

export type ConfirmMessageCallback = (path: string) => string
export type ConfirmMessage = string | ConfirmMessageCallback
