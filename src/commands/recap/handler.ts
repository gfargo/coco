import { TiktokenModel } from '@langchain/openai'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getChangesByTimestamp } from '../../lib/simple-git/getChangesByTimestamp'
import { getChangesSinceLastTag } from '../../lib/simple-git/getChangesSinceLastTag'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { CommandHandler } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleResult } from '../../lib/ui/handleResult'
import { isInteractive, LOGO } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { RecapArgv, RecapLlmResponseSchema, RecapOptions } from './config'
import { noResult } from './noResult'
import { RECAP_PROMPT } from './prompt'
import { fileChangeParser } from '../../lib/parsers/default'

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
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4o'
  )

  const llm = getLlm(provider, model, config)

  const INTERACTIVE = argv.interactive || isInteractive(config)
  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  } else {
    logger.setConfig({ silent: true })
  }

  const { 'last-month': lastMonth, 'last-tag': lastTag, yesterday, 'last-week': lastWeek } = argv

  const timeframe = lastMonth
    ? 'last-month'
    : lastTag
    ? 'last-tag'
    : yesterday
    ? 'yesterday'
    : lastWeek
    ? 'last-week'
    : argv.currentBranch || config.currentBranch
    ? 'currentBranch'
    : 'current'

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
      case 'currentBranch':
        const currentBranch = await getCurrentBranchName({ git })
        const baseBranch = config.defaultBranch || 'main'
        logger.log(`Recapping changes on branch '${currentBranch}' compared to '${baseBranch}'`)
        const changes = await getDiffForBranch({
          git,
          baseBranch,
          headBranch: currentBranch,
          options: {
            ignoredFiles: config.ignoredFiles || undefined,
            ignoredExtensions: config.ignoredExtensions || undefined,
          },
        })
        const branchChanges = await fileChangeParser({
          changes: changes.staged,
          commit: baseBranch,
          options: { tokenizer, git, llm, logger },
        })

        return [branchChanges]
      default:
        logger.log(`Invalid timeframe: ${timeframe}`, { color: 'red' })
        return []
    }
  }

  async function parser(changes: string[]) {
    return changes.join('\n')
  }

  const recapResult = await generateAndReviewLoop({
    label: 'recap',
    options: {
      ...config,
      prompt: config.prompt || (RECAP_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        enableModifyPrompt: false,
        enableEdit: false,
        enableFullRetry: false,
        selectLabel: 'Any of this ringing a bell?',
        labels: {
          approve: '👍 Looks good',
          retryMessageOnly: '🔄 Reword Recap',
          cancel: '🚫 Exit',
        },
        descriptions: {
          approve: `The generated recap for the timeframe: ${timeframe}`,
        },
      },
    },
    factory,
    parser,
    agent: async (context, options) => {
      const formatInstructions =
        "Respond with a valid JSON object, containing two fields: 'title' and 'summary', both strings."

      const prompt = getPrompt({
        template: options.prompt,
        variables: RECAP_PROMPT.inputVariables,
        fallback: RECAP_PROMPT,
      })

      try {
        const parser = createSchemaParser(RecapLlmResponseSchema, llm)
        
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

        return response ? `${response.title}\n\n${response.summary}` : 'no response'
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // Log the error but don't exit
        logger.log(`Error parsing LLM response: ${errorMessage}`, { color: 'red' })

        // Always return a fallback message instead of exiting
        const fallbackMessage = `
## Failed to parse the response [timeframe: ${timeframe}]
- There are changes in the codebase that couldn't be properly summarized due to a technical issue.
- LLM encountered issues when parsing the changes.

### Error encountered

${errorMessage}
`
        return fallbackMessage
      }
    },
    noResult: async () => {
      await noResult({ git, logger })
      if (process.env.NODE_ENV !== 'test') {
        process.exit(0)
      }
    },
  })

  // Handle the result based on the mode (interactive or stdout)
  const MODE =
    (INTERACTIVE && 'interactive') ?? (config.recap && 'interactive') ?? config?.mode ?? 'stdout' // Default to stdout

  handleResult({
    result: recapResult,
    interactiveModeCallback: async () => {
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
