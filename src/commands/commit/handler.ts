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
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { withRetry } from '../../lib/utils/retry'
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

  if (config.service.provider === 'ollama') {
    logger.verbose('⚠️  Ollama models may not strictly adhere to the output format instructions.', {
      color: 'yellow',
    })
  }

  const USE_CONVENTIONAL_COMMITS =
    config.conventionalCommits || argv.conventional

  async function factory() {
    if (config.noDiff) {
      const status = await git.status()
      return status.files.map((file) => ({
        filePath: file.path,
        status: (file.index === 'A' || file.index === '?'
          ? 'added'
          : 'modified') as FileChange['status'],
        summary: file.path, // Simplified summary for noDiff
      }))
    } else {
      const changes = await getChanges({
        git,
        options: {
          ignoredFiles: config.ignoredFiles || undefined,
          ignoredExtensions: config.ignoredExtensions || undefined,
        },
      })
      return changes.staged
    }
  }

  async function parser(changes: FileChange[]) {
    return await fileChangeParser({
      changes,
      commit: '--staged',
      options: { tokenizer, git, llm, logger },
    })
  }

  logger.log(`Generating commit message...${JSON.stringify(config.prompt)}`, { color: 'blue' })

  const commitMsg = await generateAndReviewLoop({
    label: 'commit message',
    options: {
      ...config,
      prompt:
        config.prompt ||
        ((USE_CONVENTIONAL_COMMITS
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
        customEditFunction: async (message: string, options) => {
          const { editCommitMessage } = await import('../../lib/ui/editCommitMessage')
          return editCommitMessage(message, options)
        },
      },
    },
    factory,
    parser,
    agent: async (context, options) => {

      logger.log(`Using ${USE_CONVENTIONAL_COMMITS ? 'conventional commits' : 'standard commit'} mode.`, {
        color: 'bgYellow',
      })

      // Select the appropriate schema based on whether conventional commits are enabled
      const schema = USE_CONVENTIONAL_COMMITS
        ? ConventionalCommitMessageResponseSchema
        : CommitMessageResponseSchema

      const formatInstructions = `You must always return valid JSON fenced by a markdown code block. Do not return any additional text. The JSON object you return should match the following schema:
${schema.description}`

      // Use conventional commit prompt if enabled
      const promptTemplate = USE_CONVENTIONAL_COMMITS ? CONVENTIONAL_COMMIT_PROMPT : COMMIT_PROMPT

      logger.log(`Using prompt template:\n\n${promptTemplate.template}\n`, { color: 'yellow' })

      const prompt = getPrompt({
        template: options.prompt,
        variables: promptTemplate.inputVariables,
        fallback: promptTemplate,
      })

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

      // Load commitlint rules context if available
      const hasCommitLintConfig = await hasCommitlintConfig()
      let commitlint_rules_context = ''
      if (USE_CONVENTIONAL_COMMITS || hasCommitLintConfig) {
        const { getCommitlintRulesContext } = await import('../../lib/utils/commitlintValidator')
        commitlint_rules_context = await getCommitlintRulesContext()
      }

      // Get variables for the prompt
      const variables: Record<string, string> = {
        summary: context,
        format_instructions: formatInstructions,
        additional_context: additional_context,
        commit_history: commit_history,
        branch_name_context: branchNameContext,
        commitlint_rules_context: commitlint_rules_context,
      }

      const maxAttempts =
        config.service.provider === 'ollama' && 'maxParsingAttempts' in config.service
          ? config.service.maxParsingAttempts || 3
          : 3

      logger.verbose(`Prompt variables: ${JSON.stringify(variables, null, 2)}`)
      logger.verbose(`Model: ${model}, Provider: ${provider}`, { color: 'blue' })
      logger.verbose(`Max parsing attempts: ${maxAttempts}`, { color: 'blue' })

      // Custom retry logic for commitlint validation
      let retryCount = 0
      let validationErrors = ''
      
      const generateCommitMessage = async (): Promise<string> => {
        // Update variables with validation errors for retry attempts
        const currentVariables = { 
          ...variables,
          additional_context: validationErrors ? 
            `${variables.additional_context}\n\n## Validation Errors from Previous Attempt\nPlease fix the following issues:\n${validationErrors}` : 
            variables.additional_context
        }

        const commitMsg = await executeChainWithSchema(schema, llm, prompt, currentVariables, {
          retryOptions: {
            maxAttempts,
            onRetry: (attempt: number, error: Error) => {
              logger.verbose(
                `Failed to parse commit message (attempt ${attempt}/${maxAttempts}): ${error.message}`,
                { color: 'yellow' }
              )
            },
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

        logger.log(`~~~ Generated commit message:\n\n${fullMessage}\n`, { color: 'green' })

        // If commitlint validation is needed, validate the message
        if (USE_CONVENTIONAL_COMMITS || hasCommitLintConfig) {
          const { validateCommitMessage, CommitlintValidationError } = await import('../../lib/utils/commitlintValidator')
          const validationResult = await validateCommitMessage(fullMessage)

          logger.verbose(`Validation result: ${JSON.stringify(validationResult)}`, { color: 'yellow' })

          if (!validationResult.valid) {
            retryCount++
            // Format validation errors for next attempt
            validationErrors = validationResult.errors.map(error => `- ${error}`).join('\n')
            
            // Auto-retry up to 2 times
            if (retryCount <= 2) {
              logger.verbose(`Commit message validation failed (attempt ${retryCount}/2). Retrying with error feedback...`, { color: 'yellow' })
              throw new CommitlintValidationError(
                `Validation failed: ${validationResult.errors.join('; ')}`,
                validationResult,
                fullMessage
              )
            }
            
            // After 2 failed attempts, let the user decide
            const { handleValidationErrors } = await import('../../lib/ui/commitValidationHandler')
            const validationHandlerResult = await handleValidationErrors(
              fullMessage,
              validationResult,
              {
                logger,
                interactive: INTERACTIVE,
                openInEditor: config.openInEditor,
              }
            )

            logger.verbose(`Validation handler result: ${JSON.stringify(validationHandlerResult)}`, {
              color: 'blue',
            })

            switch (validationHandlerResult.action) {
              case 'proceed':
                return validationHandlerResult.message
              case 'edit':
                return validationHandlerResult.message
              case 'regenerate':
                // Reset retry count and validation errors for fresh attempts
                retryCount = 0
                validationErrors = ''
                throw new CommitlintValidationError(
                  'User requested regeneration',
                  validationResult,
                  fullMessage
                )
              case 'abort':
                logger.log('\nAborting commit due to validation errors.', { color: 'red' })
                process.exit(1)
            }
          }
        }

        return fullMessage
      }

      // Custom shouldRetry function for commitlint errors
      const shouldRetryCommitlint = (error: Error): boolean => {
        return error.name === 'CommitlintValidationError'
      }

      // Use retry wrapper for commitlint validation with up to 4 total attempts
      // (2 automatic retries + 2 more if user chooses "Try again")
      return await withRetry(generateCommitMessage, {
        maxAttempts: 6, // Allow for multiple user retry requests
        shouldRetry: shouldRetryCommitlint,
        backoffMs: 0, // No delay needed for commitlint retries
        onRetry: (attempt: number, error: Error) => {
          if (error.name === 'CommitlintValidationError' && attempt <= 2) {
            // Don't log for auto-retries, we already log in the function
            return
          }
          logger.verbose(
            `Retrying commit message generation (attempt ${attempt}): ${error.message}`,
            { color: 'yellow' }
          )
        },
      })
    },
    noResult: async () => {
      await noResult({ git, logger })
      process.exit(0)
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  handleResult({
    result: commitMsg as string,
    interactiveModeCallback: async (result) => {
      await createCommit(result, git)
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
