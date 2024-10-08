import { JsonOutputParser } from '@langchain/core/output_parsers'
import { type TiktokenModel } from '@langchain/openai'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { fileChangeParser } from '../../lib/parsers/default'
import { createCommit } from '../../lib/simple-git/createCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getRepo } from '../../lib/simple-git/getRepo'
import { CommandHandler, FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleResult } from '../../lib/ui/handleResult'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { noResult } from './noResult'
import { CommitArgv, CommitOptions } from './options'
import { COMMIT_PROMPT } from './prompt'

interface CommitMessageResponse {
  title: string
  body: string
}

export const handler: CommandHandler<CommitArgv> = async (argv, logger) => {
  const git = getRepo()
  const options = loadConfig<CommitOptions, CommitArgv>(argv)
  const key = getApiKeyForModel(options)
  const { provider, model } = getModelAndProviderFromConfig(options)

  if (options.service.authentication.type !== 'None' && !key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const tokenizer = await getTokenCounter(
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4'
  )

  const llm = getLlm(provider, model, options)

  const INTERACTIVE = isInteractive(options)
  if (INTERACTIVE) {
    logger.log(LOGO)
  }

  async function factory() {
    const changes = await getChanges({ git })
    return changes.staged
  }

  async function parser(changes: FileChange[]) {
    return await fileChangeParser({
      changes,
      commit: '--staged',
      options: { tokenizer, git, llm, logger },
    })
  }

  const commitMsg = await generateAndReviewLoop({
    label: 'commit message',
    options: {
      ...options,
      prompt: options.prompt || (COMMIT_PROMPT.template as string),
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
      const parser = new JsonOutputParser<CommitMessageResponse>()

      const prompt = getPrompt({
        template: options.prompt,
        variables: COMMIT_PROMPT.inputVariables,
        fallback: COMMIT_PROMPT,
      })

      const formatInstructions =
        "Respond with a valid JSON object, containing two fields: 'title' and 'body', both strings."

      const commitMsg = await executeChain({
        llm,
        prompt,
        variables: { summary: context, format_instructions: formatInstructions },
        parser,
      })

      return `${commitMsg.title}\n\n${commitMsg.body}`
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (options.commit && 'interactive') || options?.mode || 'stdout'

  handleResult({
    result: commitMsg,
    interactiveHandler: async (result) => {
      await createCommit(result, git)
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
