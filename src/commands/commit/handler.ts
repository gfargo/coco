import { fileChangeParser } from '../../lib/parsers/default'
import { Logger } from '../../lib/utils/logger'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commitDefault'
import {
  getApiKeyForModel,
  getLlm as getLlm,
  getModelFromService,
  getPrompt,
} from '../../lib/langchain/utils'
import { noResult } from '../../lib/parsers/noResult'
import { getChanges } from '../../lib/simple-git/getChanges'
import { CommitOptions } from './options'
import { Argv } from 'yargs'
import { loadConfig } from '../../lib/config/loadConfig'
import { isInteractive } from '../../lib/ui/helpers'
import { FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { executeChain } from '../../lib/langchain/executeChain'
import { handleResult } from '../../lib/ui/handleResult'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { createCommit } from '../../lib/simple-git/createCommit'
import { logSuccess } from '../../lib/ui/logSuccess'

export async function handler(argv: Argv<CommitOptions>['argv']) {
  const git = getRepo()
  const options = loadConfig(argv) as CommitOptions
  const { service } = options
  const logger = new Logger(options)

  const key = getApiKeyForModel(service, options)
  const tokenizer = await getTokenCounter(getModelFromService(service))

  if (!key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const llm = getLlm(service, key, {
    temperature: 0.4,
    maxConcurrency: 10,
  })

  const INTERACTIVE = isInteractive(options)

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
    label: 'Commit Message',
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
