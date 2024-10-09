import { JsonOutputParser } from '@langchain/core/output_parsers'
import { TiktokenModel } from '@langchain/openai'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { fileChangeParser } from '../../lib/parsers/default'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getChangesByTimestamp } from '../../lib/simple-git/getChangesByTimestamp'
import { getChangesSinceLastTag } from '../../lib/simple-git/getChangesSinceLastTag'
import { getRepo } from '../../lib/simple-git/getRepo'
import { CommandHandler } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { isInteractive, LOGO } from '../../lib/ui/helpers'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { noResult } from './noResult'
import { RecapArgv, RecapOptions } from './options'
import { RECAP_PROMPT } from './prompt'

interface RecapLlmResponse {
  summary: string
}

export const handler: CommandHandler<RecapArgv> = async (argv, logger) => {
  const git = getRepo()
  const config = loadConfig<RecapOptions, RecapArgv>(argv)
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

  const { 'last-month': lastMonth, 'last-tag': lastTag, yesterday, 'last-week': lastWeek } = argv

  const timeframe = lastMonth ? 'last-month' : lastTag ? 'last-tag' : yesterday ? 'yesterday' : lastWeek ? 'last-week' : 'current'

  logger.log(`Generating recap for timeframe: ${timeframe}`)

  async function factory() {
    switch (timeframe) {
      case 'current':
        const { staged, unstaged, untracked } = await getChanges({ git })
        logger.log(
          `Staged: ${staged.length}, Unstaged: ${unstaged?.length || 0}, Untracked: ${
            untracked?.length || 0
          }`
        )
        const result = await fileChangeParser({
          changes: [...staged, ...(unstaged ? unstaged : []), ...(untracked ? untracked : [])],
          commit: 'HEAD',
          options: { tokenizer, git, llm, logger },
        })

        logger.log(`Parsed Result: ${result}`)

        return [result]
      case 'yesterday':
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return await getChangesByTimestamp({ git, since: yesterday.toISOString().split('T')[0] })
      case 'last-week':
        const lastWeek = new Date()
        lastWeek.setDate(lastWeek.getDate() - 7)
        return await getChangesByTimestamp({ git, since: lastWeek.toISOString().split('T')[0] })
      case 'last-month':
        const lastMonth = new Date()
        lastMonth.setMonth(lastMonth.getMonth() - 1)
        return await getChangesByTimestamp({ git, since: lastMonth.toISOString().split('T')[0] })
      case 'last-tag':
        const tags = await getChangesSinceLastTag({ git })
        return tags
      default:
        logger.log(`Invalid timeframe: ${timeframe}`, { color: 'red' })
        return []
    }
  }

  async function parser(changes: string[]) {
    console.log({ changes })

    return changes.join('\n')
  }

  const recap = await generateAndReviewLoop({
    label: 'recap',
    options: {
      ...config,
      prompt: config.prompt || (RECAP_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        descriptions: {
          approve: `Commit staged changes with generated commit message`,
          edit: 'Edit the commit message before proceeding',
          modifyPrompt: 'Modify the prompt template and regenerate the commit message',
          retryMessageOnly: 'Restart the function execution from generating the commit message',
          retryFull:
            'Restart the function execution from the beginning, regenerating both the diff summary and commit message',
        },
      },
    },
    factory,
    parser,
    agent: async (context, options) => {
      const parser = new JsonOutputParser<RecapLlmResponse>()

      const formatInstructions =
        "Respond with a valid JSON object, containing one field: 'summary', a string."

      const prompt = getPrompt({
        template: options.prompt,
        variables: RECAP_PROMPT.inputVariables,
        fallback: RECAP_PROMPT,
      })

      const response = await executeChain({
        llm,
        prompt,
        variables: {
          changes: context,
          format_instructions: formatInstructions,
          timeframe,
        },
        parser,
      })
      logger.log(response.summary || 'no response')

      return `${response.summary}`
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
  })

  logger.log(`Recap generated: ${recap}`, { color: 'green' })
}
