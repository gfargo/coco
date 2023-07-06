import GPT3Tokenizer from 'gpt3-tokenizer'
import { Repository } from 'nodegit'
import { getModel } from './langchain/utils'

export type FileChangeStatus =
  | 'modified'
  | 'renamed'
  | 'added'
  | 'new file'
  | 'deleted'
  | 'untracked'
  | 'unknown'

export interface FileChange {
  summary: string
  filepath: string
  oldFilepath?: string
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
export interface BaseParser {
  (
    changes: FileChange[],
    options: {
      tokenizer: GPT3Tokenizer
      model: ReturnType<typeof getModel>,
      repo: Repository
    }
  ): Promise<string>
}
