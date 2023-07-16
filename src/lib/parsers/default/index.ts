import { BaseParser } from '../../types'
import { summarizeDiffs } from './utils/summarizeDiffs'

import { createDiffTree } from './utils/createDiffTree'
import { collectDiffs } from './utils/collectDiffs'
import { getChain, getTextSplitter } from '../../langchain/utils'
import { SUMMARIZE_PROMPT } from '../../langchain/prompts/summarize'
import { getDiff } from '../../simple-git/getDiff'

const MAX_TOKENS_PER_SUMMARY = 2048

export const fileChangeParser: BaseParser = async (changes, { tokenizer, git, model, logger }) => {
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
    (path) => getDiff(path, { git, logger }),
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
    logger
  })
  logger.stopTimer(`\nSummary generated for ${changes.length} staged files`, { color: 'green' })


  return summary
}
