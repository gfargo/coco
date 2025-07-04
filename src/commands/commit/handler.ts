import { type TiktokenModel } from '@langchain/openai'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { fileChangeParser } from '../../lib/parsers/default'
import { createCommit } from '../../lib/simple-git/createCommit'
import { extractTicketIdFromBranchName } from '../../lib/simple-git/extractTicketIdFromBranchName'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getPreviousCommits } from '../../lib/simple-git/getPreviousCommits'
import { getRepo } from '../../lib/simple-git/getRepo'
import { CommandHandler, FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleResult } from '../../lib/ui/handleResult'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import {
  CommitArgv,
  CommitMessageResponseSchema,
  CommitOptions,
  ConventionalCommitMessageResponseSchema,
} from './config'
import { noResult } from './noResult'
import { COMMIT_PROMPT, CONVENTIONAL_COMMIT_PROMPT } from './prompt'

export const handler: CommandHandler<CommitArgv> = async (argv, logger) => {
  const git = getRepo()
  const config = loadConfig<CommitOptions, CommitArgv>(argv)
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

  async function factory() {
    const changes = await getChanges({
      git,
      options: {
        ignoredFiles: config.ignoredFiles || undefined,
        ignoredExtensions: config.ignoredExtensions || undefined,
      },
    })
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
      ...config,
      prompt:
        config.prompt ||
        ((config.conventionalCommits || argv.conventional
          ? CONVENTIONAL_COMMIT_PROMPT.template
          : COMMIT_PROMPT.template) as string),
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
      // Check if conventional commits are enabled via config or CLI flag
      const useConventional = config.conventionalCommits || argv.conventional

      // Select the appropriate schema based on whether conventional commits are enabled
      const schema = useConventional
        ? ConventionalCommitMessageResponseSchema
        : CommitMessageResponseSchema

      const formatInstructions = `You must always return valid JSON fenced by a markdown code block. Do not return any additional text. The JSON object you return should match the following schema:
{{ body: string, title: string }}`

      // Use conventional commit prompt if enabled
      const promptTemplate = useConventional ? CONVENTIONAL_COMMIT_PROMPT : COMMIT_PROMPT

      const prompt = getPrompt({
        template: options.prompt,
        variables: promptTemplate.inputVariables,
        fallback: promptTemplate,
      })

      if (config.service.provider === 'ollama') {
        logger.log(
          'Note: Ollama models may not strictly adhere to the output format instructions.',
          {
            color: 'yellow',
          }
        )
      }

      // Get additional context if provided
      let additional_context = ''
      if (argv.additional) {
        additional_context = `## Additional Context\n${argv.additional}`
      }

      // Get commit history if requested
      let commit_history = ''
      if (argv.withPreviousCommits > 0) {
        const commitHistoryData = await getPreviousCommits({
          git,
          count: argv.withPreviousCommits,
        })

        if (commitHistoryData) {
          commit_history = `## Commit History\n${commitHistoryData}`
        }
      }

      // Get current branch name - we need this for ticket extraction regardless of prompt inclusion
      const branchName = await getCurrentBranchName({ git })

      // Check if branch name should be included in the prompt context
      const includeBranchName =
        argv.includeBranchName !== undefined
          ? argv.includeBranchName
          : config.includeBranchName !== false // Default to true if not explicitly set to false

      // Create branch name context string based on the configuration
      const branchNameContext = includeBranchName ? `Current git branch name: ${branchName}` : ''

      // Get variables for the prompt
      const variables: Record<string, string> = {
        summary: context,
        format_instructions: formatInstructions,
        additional_context: additional_context,
        commit_history: commit_history,
        branch_name_context: branchNameContext,
      }

      const maxAttempts =
        config.service.provider === 'ollama' && 'maxParsingAttempts' in config.service
          ? config.service.maxParsingAttempts || 3
          : 3

      const commitMsg = await executeChainWithSchema(schema, llm, prompt, variables, {
        retryOptions: {
          maxAttempts,
          onRetry: (attempt: number, error: Error) => {
            logger.verbose(
              `Failed to parse commit message (attempt ${attempt}/${maxAttempts}): ${error.message}`,
              { color: 'yellow' }
            )
          }
        },
        fallbackParser: (text: string) => ({
          title: text.split('\n')[0] || 'Auto-generated commit',
          body: text.split('\n').slice(1).join('\n') || 'Generated commit message',
        }),
        onFallback: () => {
          logger.verbose('Max retry attempts reached. Falling back to simple text output.', {
            color: 'red',
          })
        },
      })

      // Construct the full commit message
      const appendedText = argv.append ? `\n\n${argv.append}` : ''
      const ticketId = extractTicketIdFromBranchName(branchName)
      const ticketFooter = argv.appendTicket && ticketId ? `\n\nPart of **${ticketId}**` : ''
      const fullMessage = `${commitMsg.title}\n\n${commitMsg.body}${appendedText}${ticketFooter}`

      // If conventional commits are enabled, validate with commitlint
      if (useConventional) {
        const { validateCommitMessage } = await import('../../lib/utils/commitlintValidator')
        const { handleValidationErrors } = await import('../../lib/ui/commitValidationHandler')

        const validationResult = await validateCommitMessage(fullMessage)
        const validationHandlerResult = await handleValidationErrors(
          fullMessage,
          validationResult,
          {
            logger,
            interactive: INTERACTIVE,
            openInEditor: config.openInEditor,
          }
        )

        switch (validationHandlerResult.action) {
          case 'proceed':
            // Validation passed, use the message as is
            return validationHandlerResult.message

          case 'edit':
            // User edited the message, use the edited version
            return validationHandlerResult.message

          case 'regenerate':
            // User wants to regenerate, throw special error to trigger regeneration
            throw new Error('REGENERATE_COMMIT_MESSAGE')

          case 'abort':
            // User wants to abort or validation failed in non-interactive mode
            logger.log('\nAborting commit due to validation errors.', { color: 'red' })
            process.exit(1)
        }
      }

      return fullMessage
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  handleResult({
    result: commitMsg,
    interactiveModeCallback: async (result) => {
      await createCommit(result, git)
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
