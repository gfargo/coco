import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'

import { loadConfig } from '../../lib/config/utils/loadConfig'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { ChangelogArgv, ChangelogOptions } from './options'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { handleResult } from '../../lib/ui/handleResult'
import { CHANGELOG_PROMPT } from './prompt'
import { getCommitLogRange } from '../../lib/simple-git/getCommitLogRange'
import { getCommitLogCurrentBranch } from '../../lib/simple-git/getCommitLogCurrentBranch'
import { getRepo } from '../../lib/simple-git/getRepo'
import { logSuccess } from '../../lib/ui/logSuccess'
import { CommandHandler } from '../../lib/types'

export const handler: CommandHandler<ChangelogArgv> = async (argv, logger) => {
  const config = loadConfig<ChangelogOptions, ChangelogArgv>(argv)
  const git = getRepo()
  const key = getApiKeyForModel(config)
  const { provider, model } = getModelAndProviderFromConfig(config)

  if (config.service.authentication.type !== 'None' && !key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const llm = getLlm(provider, model, config)

  const INTERACTIVE = isInteractive(config)

  if (INTERACTIVE) {
    logger.log(LOGO)
  }

  async function factory() {
    if (config.range && config.range.includes(':')) {
      const [from, to] = config.range.split(':')

      if (!from || !to) {
        logger.log(`Invalid range provided. Expected format is <from>:<to>`, { color: 'red' })
        process.exit(1)
      }

      return await getCommitLogRange(from, to, { git, noMerges: true })
    }

    logger.verbose(`No range provided. Defaulting to current branch`, { color: 'yellow' })
    return await getCommitLogCurrentBranch({ git, logger })
  }

  async function parser(messages: string[]) {
    const result = messages.join('\n')
    return result
  }

  const changelogMsg = await generateAndReviewLoop({
    label: 'changelog',
    factory,
    parser,
    agent: async (context, options) => {
      const prompt = getPrompt({
        template: options.prompt,
        variables: CHANGELOG_PROMPT.inputVariables,
        fallback: CHANGELOG_PROMPT,
      })

      return await executeChain({
        llm,
        prompt,
        variables: { summary: context },
      })
    },
    noResult: async () => {
      if (config.range) {
        logger.log(`No commits found in the provided range.`, { color: 'red' })
        process.exit(0)
      }

      logger.log(`No commits found in the current branch.`, { color: 'red' })
      process.exit(0)
    },
    options: {
      ...config,
      prompt: config.prompt || (CHANGELOG_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        enableFullRetry: false,
      },
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  handleResult({
    result: changelogMsg,
    interactiveHandler: async () => {
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
