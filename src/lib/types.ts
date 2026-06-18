import { SimpleGit } from 'simple-git'
import { getLlm } from './langchain/utils/getLlm'
import { LlmCallMetadata } from './langchain/utils/observability'
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
  /**
   * Opt-in fast paths that trade summary detail for speed. Mirrors the
   * `service.fastPath` shape. Off by default; lossless optimizations
   * are not configured here.
   */
  fastPath?: {
    /**
     * Replace the LLM summary with a templated heading extract for
     * markdown modification diffs with structural signals.
     * @default false
     */
    markdown?: boolean
    /**
     * Language-aware structural fast path (#883). Replaces the LLM
     * summary with a symbol-level extract ("added parseRequest();
     * removed legacyParse()") for source files in the listed
     * languages. Off by default — lossy by design, and quality is
     * harder to validate than the markdown fast path.
     */
    languageAware?: {
      enabled?: boolean
      /**
       * Languages to opt in. Omit / empty to enable all currently
       * supported languages. Today: 'ts' (covers .ts/.tsx/.mts/.cts),
       * 'js' (covers .js/.jsx/.mjs/.cjs).
       */
      languages?: (
        | 'ts'
        | 'js'
        | 'py'
        | 'rs'
        | 'go'
        | 'java'
        | 'cpp'
        | 'cs'
        | 'rb'
        | 'php'
        | 'kt'
        | 'swift'
      )[]
    }
  }
  metadata?: Partial<LlmCallMetadata>
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
