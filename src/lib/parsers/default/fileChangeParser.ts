import config from '../../config'
import { BaseParser } from '../../types'
import { summarizeDiffs } from './utils/summarizeDiffs'
import { Logger } from '../../utils/logger'

import { createDiffTree } from './utils/createDiffTree'
import { collectDiffs } from './utils/collectDiffs'
import { parseFileDiff } from './utils/parseFileDiff'
import { getChain, getTextSplitter } from '../../langchain/utils'
import { SUMMARIZE_PROMPT } from '../../langchain/prompts/summarize'

const MAX_TOKENS_PER_SUMMARY = 2048

export const fileChangeParser: BaseParser = async (changes, { tokenizer, repo, model }) => {
  const logger = new Logger(config)
  const head = await repo.getHeadCommit()
  const headTree = await head.getTree()
  const index = await repo.refreshIndex()

  const textSplitter = getTextSplitter({ chunkSize: 2000, chunkOverlap: 125, })
  const summarizationChain = getChain(model, {
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
    (path) => parseFileDiff(path, repo, headTree, index, logger),
    tokenizer,
    logger
  )
  logger.stopSpinner('Diffs Collected').stopTimer()

  // Summarize diffs
  logger.startTimer()
  const summary = await summarizeDiffs(diffs, {
    tokenizer,
    maxTokens: MAX_TOKENS_PER_SUMMARY,
    textSplitter,
    chain: summarizationChain,
  })
  logger.stopTimer(`\nSummary generated for ${changes.length} staged files`, { color: 'green' })

  return summary
}
