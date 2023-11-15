import { Logger } from '../../lib/utils/logger'
import { getApiKeyForModel, getModel, getPrompt } from '../../lib/langchain/utils'
import { simpleGit, SimpleGit } from 'simple-git'
import { Argv } from 'yargs'
import { loadConfig } from '../../lib/config/loadConfig'
import { isInteractive } from '../../lib/ui/helpers'
import { ChangelogOptions } from './options'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { executeChain } from '../../lib/langchain/executeChain'
import { noResult } from '../../lib/parsers/noResult'
import { handleResult } from '../../lib/ui/handleResult'
import { CHANGELOG_PROMPT } from '../../lib/langchain/prompts/changelog'
 
const git: SimpleGit = simpleGit()

async function getCommitMessagesBetween(
  git: SimpleGit,
  fromCommit: string,
  toCommit: string
): Promise<string[]> {
  try {
    // Using the 'raw' method to execute the 'git log' command with the desired options.
    const output = await git.raw([
      'log',
      `${fromCommit}..${toCommit}`,
      '--pretty=format:%s', // This tells git to output only the commit messages.
      // You could also include '--no-merges' here if you want to exclude merge commits.
    ])

    // The 'output' will be a string with each commit message on a new line.
    // Split the output by new lines to create an array of commit messages.
    const messages = output.split('\n').filter(Boolean) // filter(Boolean) removes any empty strings
    return messages
  } catch (error) {
    // If there's an error, handle it appropriately
    console.error('Error getting commit messages:', error)
    throw error
  }
}

export async function handler(argv: Argv<ChangelogOptions>['argv']) {
  const options = loadConfig(argv) as ChangelogOptions
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
    const messages = await getCommitMessagesBetween(
      git,
      '00427c6d0ba35159caa4f0fdf90738e463b8ec88',
      'HEAD'
    )
    return messages
  }

  async function parser(messages: string[]) {
    return messages.join('\n')
  }

  const changelogMsg = await generateAndReviewLoop({
    factory,
    parser,
    agent: async (context, options) => {
      const prompt = getPrompt({
        template: options.prompt,
        variables: CHANGELOG_PROMPT.inputVariables,
        fallback: CHANGELOG_PROMPT,
      })

      console.log('prompt', { options, prompt })

      return await executeChain({
        llm: model,
        prompt,
        variables: { summary: context },
      })
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
    options: {
      ...options,
      prompt: options.prompt || CHANGELOG_PROMPT.template,
      logger,
      interactive: INTERACTIVE,
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (options.commit && 'interactive') || options?.mode || 'stdout'

  handleResult(changelogMsg, {
    mode: MODE as 'interactive' | 'stdout',
    git,
  })
}
