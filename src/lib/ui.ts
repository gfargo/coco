import chalk from 'chalk'
import { select, editor } from '@inquirer/prompts'
import { type SimpleGit } from 'simple-git'
import { fileChangeParser } from '../lib/parsers/default'
import { getTokenizer } from '../lib/utils/getTokenizer'
import { Logger } from '../lib/utils/logger'
import { COMMIT_PROMPT } from '../lib/langchain/prompts/commitDefault'
import {
  getModel,
  getPrompt,
  validatePromptTemplate,
} from '../lib/langchain/utils'
import { llm } from '../lib/langchain/chains/llm'
import { noResult } from '../lib/parsers/noResult'
import { createCommit } from '../lib/simple-git/createCommit'

import { CommitOptions } from '../commands/commit'
import { FileChange } from './types'

const SEPERATOR = chalk.blue('----------------')

export const isInteractive = (argv: CommitOptions) => {
  return argv?.mode === 'interactive' || argv.interactive
}

export const logCommit = (commit: string) => {
  console.log(
    `\n${chalk.bgBlue(chalk.bold('Proposed Commit:'))}\n${SEPERATOR}\n${commit}\n${SEPERATOR}\n`
  )
}

export const logSuccess = () => {
  console.log(chalk.green(chalk.bold('\nAll set! 🦾🤖')))
}

type GenerateReviewLoopOptions = {
  git: SimpleGit
  interactive: boolean
  model: ReturnType<typeof getModel>
  tokenizer: ReturnType<typeof getTokenizer>
  logger: Logger
  prompt?: string
  openInEditor?: boolean
}

export const generateCommitMessageAndReviewLoop = async (
  changes: FileChange[],
  options: GenerateReviewLoopOptions
) => {
  const { logger, model, git, tokenizer } = options

  let summary = ''
  let commitMsg = ''
  let promptTemplate = options?.prompt || ''
  let modifyPrompt = false
  // determine if we continue generating commit messages
  let continueLoop = true

  while (continueLoop) {
    if (changes.length !== 0 && !summary.length) {
      logger.verbose(`\nChanged Files: \n ${changes.map(({ summary }) => summary).join('\n ')}`, {
        color: 'blue',
      })

      summary = await fileChangeParser(changes, { tokenizer, git, model, logger })
    }

    // Handle empty summary
    if (!summary.length) {
      await noResult({ git, logger })
      process.exit(0)
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

    if (options?.interactive) {
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
        options.openInEditor = true
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

    if (options.openInEditor) {
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

    continueLoop = false
  }

  return commitMsg
}

export const handleResult = async (
  commit: string,
  { mode, git }: { mode: 'interactive' | 'stdout'; git: SimpleGit }
) => {
  // Handle resulting commit message
  switch (mode) {
    case 'interactive':
      await createCommit(commit, git)
      logSuccess()
      break
    case 'stdout':
    default:
      process.stdout.write(commit, 'utf8')
      break
  }

  process.exit(0)
}
