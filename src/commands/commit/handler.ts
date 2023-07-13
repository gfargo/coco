import { select, editor } from '@inquirer/prompts'
import config from '../../lib/config'
import { fileChangeParser } from '../../lib/parsers/default'
import { logCommit, logSuccess } from '../../lib/ui'
import { getTokenizer } from '../../lib/utils/getTokenizer'
import { Logger } from '../../lib/utils/logger'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commitDefault'
import { getModel, getPrompt, validatePromptTemplate } from '../../lib/langchain/utils'
import { llm } from '../../lib/langchain/chains/llm'
import { noResult } from '../../lib/parsers/noResult'
import { getChanges } from '../../lib/simple-git/getChanges'
import { createCommit } from '../../lib/simple-git/createCommit'
import { simpleGit, SimpleGit } from 'simple-git'
import { CommitOptions } from './options'

// const argv = loadArgv()
const tokenizer = getTokenizer()
const git: SimpleGit = simpleGit()

export async function handler(options: CommitOptions) {
  const logger = new Logger(config)

  if (!config.openAIApiKey) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const model = getModel({
    temperature: 0.4,
    maxConcurrency: 10,
    openAIApiKey: config.openAIApiKey,
  })

  const INTERACTIVE = config?.mode === 'interactive' || options.interactive

  const { staged: changes } = await getChanges(git)

  let summary = ''
  let commitMsg = ''
  let promptTemplate = config?.prompt || ''
  let modifyPrompt = false

  while (true) {
    if (changes.length !== 0 && !summary.length) {
      logger.verbose(`\nChanged Files: \n ${changes.map(({ summary }) => summary).join('\n ')}`, {
        color: 'blue',
      })

      summary = await fileChangeParser(changes, { tokenizer, git, model })
    }

    // Handle empty summary
    if (!summary.length) {
      noResult({ git, logger })
    }

    // Prompt user for commit template prompt, if necessary
    if (modifyPrompt) {
      promptTemplate = await editor({
        message: 'Edit the prompt',
        default: promptTemplate.length ? promptTemplate : COMMIT_PROMPT.template,
        waitForUseInput: false,
        validate: (text) => validatePromptTemplate(text, COMMIT_PROMPT.inputVariables),
      })
    }

    logger.startTimer().startSpinner(`Generating Commit Message\n`, {
      color: 'blue',
    })

    commitMsg = await llm({
      llm: model,
      prompt: getPrompt({
        template: promptTemplate,
        variables: COMMIT_PROMPT.inputVariables,
        fallback: COMMIT_PROMPT,
      }),
      variables: { summary },
    })

    if (!commitMsg) {
      logger.stopSpinner('💀 Failed to generate commit message.', {
        mode: 'fail',
        color: 'red',
      })
      process.exit(0)
    }

    logger
      .stopSpinner('Generated Commit Message', {
        color: 'green',
        mode: 'succeed',
      })
      .stopTimer()

    if (INTERACTIVE) {
      logCommit(commitMsg)
      const reviewAnswer = await select({
        message: 'Would you like to make any changes to the commit message?',
        choices: [
          {
            name: '✨ Looks good!',
            value: 'approve',
            description: 'Commit staged changes with generated commit message',
          },
          {
            name: '📝 Edit',
            value: 'edit',
            description: 'Edit the commit message before proceeding',
          },
          {
            name: '🪶  Modify Prompt',
            value: 'modifyPrompt',
            description: 'Modify the prompt template and regenerate the commit message',
          },
          {
            name: '🔄 Retry - Message Only',
            value: 'retryMessageOnly',
            description: 'Restart the function execution from generating the commit message',
          },
          {
            name: '🔄 Retry - Full',
            value: 'retryFull',
            description:
              'Restart the function execution from the beginning, regenerating both the diff summary and commit message',
          },
          {
            name: '💣 Cancel',
            value: 'cancel',
          },
        ],
      })

      if (reviewAnswer === 'cancel') {
        process.exit(0)
      }

      if (reviewAnswer === 'edit') {
        config.openInEditor = true
      }

      if (reviewAnswer === 'retryFull') {
        summary = ''
        commitMsg = ''
        promptTemplate = ''
        continue
      }

      if (reviewAnswer === 'retryMessageOnly') {
        modifyPrompt = false
        commitMsg = ''
        continue
      }

      if (reviewAnswer === 'modifyPrompt') {
        modifyPrompt = true
        commitMsg = ''
        continue
      }
    }

    if (config.openInEditor) {
      commitMsg = await editor({
        message: 'Edit the commit message',
        default: commitMsg,
        waitForUseInput: false,
        validate: (text) => {
          if (!text) {
            return 'Commit message cannot be empty'
          }
          return true
        },
      })
    }

    const MODE =
      (options.interactive && 'interactive') ||
      (options.commit && 'interactive') ||
      config?.mode ||
      'stdout'

    // Handle resulting commit message
    switch (MODE) {
      case 'interactive':
        await createCommit(commitMsg, git)
        logSuccess()
        break
      case 'stdout':
      default:
        process.stdout.write(commitMsg, 'utf8')
        break
    }

    process.exit(0)
  }
}
