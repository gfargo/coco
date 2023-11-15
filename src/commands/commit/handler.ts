import { fileChangeParser } from '../../lib/parsers/default'
import { getTokenizer } from '../../lib/utils/getTokenizer'
import { Logger } from '../../lib/utils/logger'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commitDefault'
import { getApiKeyForModel, getModel, getPrompt } from '../../lib/langchain/utils'
import { noResult } from '../../lib/parsers/noResult'
import { getChanges } from '../../lib/simple-git/getChanges'
import { simpleGit, SimpleGit } from 'simple-git'
import { CommitOptions } from './options'
import { Argv } from 'yargs'
import { loadConfig } from '../../lib/config/loadConfig'
import { isInteractive } from '../../lib/ui/helpers'
import { FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { executeChain } from '../../lib/langchain/executeChain'
import { handleResult } from '../../lib/ui/handleResult'

const tokenizer = getTokenizer()
const git: SimpleGit = simpleGit()

export async function handler(argv: Argv<CommitOptions>['argv']) {
  const options = loadConfig(argv) as CommitOptions
  const logger = new Logger(options)
  
  const key = getApiKeyForModel(options.model, options)

  if (!key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const model = getModel(options.model, key, {
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
      options: { tokenizer, git, model, logger },
    })
  }

  const commitMsg = await generateAndReviewLoop({
    factory,
    parser,
    agent: async (context, options) => {
      return await executeChain({
        llm: model,
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
      logger,
      interactive: INTERACTIVE,
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (options.commit && 'interactive') || options?.mode || 'stdout'

  handleResult(commitMsg, {
    mode: MODE as 'interactive' | 'stdout',
    git,
  })
}
