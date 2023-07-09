import GPT3Tokenizer from 'gpt3-tokenizer'
import { DirectoryDiff, DiffNode } from '../../../types'
import pQueue from 'p-queue'
import { Logger } from '../../../utils/logger'
import config from '../../../config'
import { getPathFromFilePath } from '../../../utils/getPathFromFilePath'
import { SummarizeContext, summarize } from '../../../langchain/chains/summarize'

/**
 * Create groups from a given node info.
 * @param {DiffNode} node - The node info to start grouping.
 * @returns {DirectoryDiff[]} The groups created.
 */
export function createDirectoryDiffs(node: DiffNode): DirectoryDiff[] {
  const groupByPath: Record<string, DirectoryDiff> = {}

  function traverse(node: DiffNode) {
    node.diffs.forEach((diff) => {
      const path = getPathFromFilePath(diff.file)
      if (!groupByPath[path]) {
        groupByPath[path] = { diffs: [], path, tokenCount: 0 }
      }
      groupByPath[path].diffs.push(diff)
      groupByPath[path].tokenCount += diff.tokenCount
    })

    node.children.forEach(traverse)
  }

  traverse(node)
  return Object.values(groupByPath)
}

type SummarizeDirectoryDiffOptions = {
  tokenizer: GPT3Tokenizer
} & SummarizeContext

/**
 * Summarize a directory diff asynchronously.
 */
export async function summarizeDirectoryDiff(
  directory: DirectoryDiff,
  { chain, textSplitter, tokenizer }: SummarizeDirectoryDiffOptions
): Promise<DirectoryDiff> {
  try {
    const directorySummary = await summarize(
      directory.diffs.map((diff) => ({
        pageContent: diff.diff,
        metadata: {
          file: diff.file,
          summary: diff.summary,
        },
      })),
      {
        chain,
        textSplitter,
        options: {
          returnIntermediateSteps: true,
        },
      }
    )

    const newTokenTotal = tokenizer.encode(directorySummary).text.length

    return {
      diffs: directory.diffs,
      path: directory.path,
      summary: directorySummary,
      tokenCount: newTokenTotal,
    }
  } catch (error) {
    console.error(error)
    return directory
  }
}

const defaultOutputCallback = (group: DirectoryDiff) => {
  let output = `
-------\n* changes in "/${group.path}"\n\n`

  if (group.summary) {
    output += `${group.diffs.map((diff) => ` • ${diff.summary}`).join('\n')}\n\nSummary:\n\n${
      group.summary
    }\n\n`
  } else {
    output += `${group.diffs.map((diff) => ` • ${diff.summary}\n\n${diff.diff}`).join('\n\n')}\n\n`
  }

  return output
}

type SummarizeDiffsOptions = {
  tokenizer: GPT3Tokenizer
  maxTokens: number
  handleOutput?: typeof defaultOutputCallback
} & SummarizeContext

export async function summarizeDiffs(
  rootDiffNode: DiffNode,
  {
    tokenizer,
    maxTokens = 2048,
    textSplitter,
    chain,
    handleOutput = defaultOutputCallback,
  }: SummarizeDiffsOptions
): Promise<string> {
  const logger = new Logger(config)
  const queue = new pQueue({ concurrency: 8 })

  logger.startTimer().startSpinner(`Organizing Diffs...`, { color: 'blue' })
  const directoryDiffs = createDirectoryDiffs(rootDiffNode)

  // Sort by token count descending
  directoryDiffs.sort((a, b) => b.tokenCount - a.tokenCount)

  let totalTokenCount = directoryDiffs.reduce((sum, group) => sum + group.tokenCount, 0)

  logger.stopSpinner('Diffs Organized').stopTimer()

  logger.startSpinner(`Consolidating Diffs`, { color: 'blue' })
  const processingTasks = directoryDiffs.map((group, i) => {
    return queue.add(
      async () => {
        // If the diff token count is already less than the average req, we can skip summarizing.
        const isLessThanAvgTokenReq = group.tokenCount <= maxTokens / directoryDiffs.length

        if (totalTokenCount <= maxTokens || isLessThanAvgTokenReq) {
          return group
        }

        group = await summarizeDirectoryDiff(group, {
          chain,
          textSplitter,
          tokenizer,
        })

        // We need to subtract the old token count and add the new one
        totalTokenCount = totalTokenCount - directoryDiffs[i].tokenCount + group.tokenCount
        directoryDiffs[i] = group

        logger
          .verbose(`\n • Summarized diffs in "/${group.path}" `, { color: 'blue' })
          .verbose(`\nTotal token count: ${totalTokenCount}`, {
            color: totalTokenCount > maxTokens ? 'yellow' : 'green',
          })

        return group
      },
      { priority: group.tokenCount }
    )
  })

  await Promise.all(processingTasks)
  logger.stopSpinner(`Summarized Diffs`)

  return directoryDiffs.map(handleOutput).join('')
}
