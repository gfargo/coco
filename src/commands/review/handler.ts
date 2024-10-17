import { JsonOutputParser } from '@langchain/core/output_parsers'
import { TiktokenModel } from '@langchain/openai'
import chalk from 'chalk'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { fileChangeParser } from '../../lib/parsers/default/index'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getRepo } from '../../lib/simple-git/getRepo'
import { CommandHandler } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { isInteractive, LOGO, severityColor } from '../../lib/ui/helpers'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { noResult } from './noResult'
import { ReviewArgv, ReviewFeedbackItem, ReviewOptions } from './options'
import { REVIEW_PROMPT } from './prompt'
import { TaskList } from './TaskList'

export const handler: CommandHandler<ReviewArgv> = async (argv, logger) => {
  const git = getRepo()
  const config = loadConfig<ReviewOptions, ReviewArgv>(argv)
  const key = getApiKeyForModel(config)
  const { provider, model } = getModelAndProviderFromConfig(config)

  if (config.service.authentication.type !== 'None' && !key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const tokenizer = await getTokenCounter(
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4'
  )

  const llm = getLlm(provider, model, config)

  const INTERACTIVE = isInteractive(config)
  if (INTERACTIVE) {
    logger.log(LOGO)
  }

  async function factory() {
    const { staged, unstaged, untracked } = await getChanges({ git })
    if (staged.length === 0 && unstaged?.length === 0 && untracked?.length === 0) {
      logger.log('No changes detected. Exiting...')
      process.exit(0)
    }

    if (INTERACTIVE) {
      logger.verbose(
        `Staged: ${staged.length}, Unstaged: ${unstaged?.length || 0}, Untracked: ${
          untracked?.length || 0
        }`
      )
    }

    const unstagedChanges = await fileChangeParser({
      changes: unstaged || [],
      commit: '--unstaged',
      options: { tokenizer, git, llm, logger },
    })

    const unstagedResponse = `Unstaged changes:\n${unstagedChanges}`

    const untrackedChanges = await fileChangeParser({
      changes: untracked || [],
      commit: '--untracked',
      options: { tokenizer, git, llm, logger },
    })
    const untrackedResponse = `Untracked changes:\n${untrackedChanges}`

    const stagedChanges = await fileChangeParser({
      changes: staged,
      commit: '--staged',
      options: { tokenizer, git, llm, logger },
    })
    const stagedResponse = `Staged changes:\n${stagedChanges}`

    return [unstagedResponse, untrackedResponse, stagedResponse]
  }

  async function parser(changes: string[]) {
    return changes.join('\n')
  }

  const recap = await generateAndReviewLoop({
    label: 'review',
    options: {
      ...config,
      prompt: config.prompt || (REVIEW_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        selectLabel: 'Review the proposed feedback before starting',
        enableModifyPrompt: false,
        enableEdit: false,
        descriptions: {
          retryMessageOnly: 'Create new code review based on the same diff summary',
          retryFull:
            'Restart the function execution from the beginning, regenerating both the diff summary and code review',
        },
        labels: {
          approve: '✨ Begin review',
        },
      },
    },
    factory,
    parser,
    agent: async (context, options) => {
      const parser = new JsonOutputParser<ReviewFeedbackItem[]>()

      const formatInstructions =
        "Respond with a valid JSON object, containing four fields:'title' a string, 'summary' a short summary of the problem (include line number if big file), 'severity' a numeric enum up to ten, 'category' an enum string, and 'filePath' a relative filepath to file as string."

      const prompt = getPrompt({
        template: options.prompt,
        variables: REVIEW_PROMPT.inputVariables,
        fallback: REVIEW_PROMPT,
      })

      const response = await executeChain({
        llm,
        prompt,
        variables: {
          changes: context,
          format_instructions: formatInstructions,
        },
        parser,
      })

      // sort by severity
      return response.sort((a, b) => b.severity - a.severity)
    },
    reviewParser(result) {
      return result
        .map((task) => {
          const color = severityColor(task.severity)
          return color(
            `[${task.severity}] ${chalk.bold(task.title)} (${task.category})\n ${chalk.dim(
              `→ "${task.filePath}"`
            )}`
          )
        })
        .join('\n\n')
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
  })

  const reviewer = new TaskList(recap)
  await reviewer.start()
}
