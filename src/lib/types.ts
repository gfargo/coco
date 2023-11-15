import { getModel } from './langchain/utils'
import { SimpleGit } from 'simple-git'
import { Logger } from './utils/logger'
import { getTokenizer } from './utils/getTokenizer'

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
  tokenizer: ReturnType<typeof getTokenizer>
  model: ReturnType<typeof getModel>
  git: SimpleGit
  logger: Logger
}

export interface BaseParserInput {
  options: BaseParserOptions
}

export interface FileChangeParserInput extends BaseParserInput {
  changes: FileChange[]
  commit: '--staged' | string
}

export interface CommitLogParserInput extends BaseParserInput {
  range: {
    from: string
    to: string
  }
}
