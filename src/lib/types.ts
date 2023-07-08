import GPT3Tokenizer from 'gpt3-tokenizer'
import { getModel } from './langchain/utils'
import { SimpleGit } from 'simple-git'

export type FileChangeStatus =
  | 'modified'
  | 'renamed'
  | 'added'
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
      git: SimpleGit
    }
  ): Promise<string>
}
