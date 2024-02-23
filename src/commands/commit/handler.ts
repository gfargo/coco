import { fileChangeParser } from '../../lib/parsers/default'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commit'
import { getApiKeyForModel } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { noResult } from '../../lib/parsers/noResult'
import { getChanges } from '../../lib/simple-git/getChanges'
import { CommitArgv, CommitOptions } from './options'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { CommandHandler, FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { handleResult } from '../../lib/ui/handleResult'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { createCommit } from '../../lib/simple-git/createCommit'
import { logSuccess } from '../../lib/ui/logSuccess'

export const handler: CommandHandler<CommitArgv> = async (argv, logger) => {
  const git = getRepo()
  const options = loadConfig<CommitOptions, CommitArgv>(argv)
  const { service } = options

  console.log({ options })

  const key = getApiKeyForModel(options)

  console.log({ key, service })

  // const tokenizer = await getTokenCounter(getModelFromService(service))
  const tokenizer = await getTokenCounter('gpt-4') // TODO: Remove hard coded tokenizer

  if (!key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  console.log({ service })

  const llm = getLlm(options)

  console.log({llm})

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
    factory,
    parser,
    agent: async (context, options) => {
      return await executeChain({
        llm,
        prompt: getPrompt({
          template: options.prompt,
          variables: COMMIT_PROMPT.inputVariables,
          fallback: COMMIT_PROMPT,
        }),
        variables: { summary: context },
      })
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
    options: {
      ...options,
      prompt: options.prompt || COMMIT_PROMPT.template,
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
