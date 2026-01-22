import { FileChangeParserInput } from '../../types'
import { summarizeDiffs } from './utils/summarizeDiffs'
import { collectDiffs } from './utils/collectDiffs'
import { createDiffTree } from './utils/createDiffTree'
import { SUMMARIZE_PROMPT } from '../../langchain/chains/summarize/prompt'
import { getDiff } from '../../simple-git/getDiff'
import { loadSummarizationChain } from 'langchain/chains'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export async function fileChangeParser({
  changes,
  commit,
  options: {
    tokenizer,
    git,
    llm: model,
    logger,
    maxTokens,
    minTokensForSummary,
    maxFileTokens,
    maxConcurrent,
  },
}: FileChangeParserInput): Promise<string> {
  const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 10000, chunkOverlap: 250 })

  const summarizationChain = loadSummarizationChain(model, {
    type: 'map_reduce',
    combineMapPrompt: SUMMARIZE_PROMPT,
    combinePrompt: SUMMARIZE_PROMPT,
  })

  logger.startTimer()
  const rootTreeNode = createDiffTree(changes)
  logger.stopTimer('Created file hierarchy')

  // Collect diffs
  logger.startTimer().startSpinner(`Collecting Diffs...\n`, { color: 'blue' })
  const diffs = await collectDiffs(
    rootTreeNode,
    (path) => getDiff(path, commit, { git, logger }),
    tokenizer,
    logger
  )
  logger.stopSpinner('Diffs Collected').stopTimer()

  // Summarize diffs using three-phase approach:
  // 1. Pre-process large files to prevent bias
  // 2. Group by directory and assess token count
  // 3. Wave-based parallel summarization until under budget
  logger.startTimer()
  const summary = await summarizeDiffs(diffs, {
    tokenizer,
    maxTokens: maxTokens || 2048,
    minTokensForSummary,
    maxFileTokens,
    maxConcurrent,
    textSplitter,
    chain: summarizationChain,
    logger,
  })
  logger.stopTimer(`\nSummary generated for ${changes.length} staged files`, { color: 'green' })

  return summary
}
