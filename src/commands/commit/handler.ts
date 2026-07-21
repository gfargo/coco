import { LLMModel } from '../../lib/langchain/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { formatCommitMessage } from '../../lib/langchain/utils/formatCommitMessage'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { logLlmTelemetrySummary } from '../../lib/langchain/utils/observability'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { getLanguageContext } from '../../lib/langchain/utils/languageContext'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { PreCommitHookError, createCommit } from '../../lib/simple-git/createCommit'
import { generateCommitDraft } from './generateCommitDraft'
import { extractTicketIdFromBranchName } from '../../lib/simple-git/extractTicketIdFromBranchName'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getPreviousCommits } from '../../lib/simple-git/getPreviousCommits'
import { CommandHandler, FileChange } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { handleResult } from '../../lib/ui/handleResult'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { promptHookFailureRecovery } from '../../lib/ui/hookFailurePrompt'
import { logSuccess } from '../../lib/ui/logSuccess'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
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
import { salvageCommitMessageFromText } from './salvageCommitMessage'
import { handleCommitSplit, isCommitSplitCommand } from './split'

export const handler: CommandHandler<CommitArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  // `--print-message`: generate a draft and print it to stdout without
  // committing. Skips the interactive review loop, the split planner, and
  // `createCommit` entirely — this is the non-interactive path the
  // `prepare-commit-msg` hook installed via `coco hooks install` calls on
  // every plain `git commit` (#1591).
  if (argv.printMessage) {
    const result = await generateCommitDraft({ git, argv, logger })
    if (!result.ok || !result.draft) {
      for (const warning of result.warnings) {
        logger.verbose(warning, { color: 'yellow' })
      }
      for (const validationError of result.validationErrors) {
        logger.verbose(validationError, { color: 'red' })
      }
      commandExit(1)
    }
    process.stdout.write(`${result.draft}\n`)
    return
  }

  const config = loadConfig<CommitOptions, CommitArgv>(argv)
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const commitService = resolveDynamicService(config, 'commit')
  const summaryService = resolveDynamicService(config, 'summarize')
  const splitService = resolveDynamicService(config, 'commitSplit')
  const model = commitService.model

  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'commit' })
  }

  const tokenizer = await getTokenCounterForProvider(provider, String(model))

  const llm = await getLlm(provider, model as LLMModel, { ...config, service: commitService })
  const summaryLlm = await getLlm(provider, summaryService.model as LLMModel, { ...config, service: summaryService })
  // The split planner uses a dedicated LLM because its output schema
  // is far stricter than the regular commit-message path (every staged
  // file claimed exactly once, no cross-group duplication, hunk-vs-
  // file mode exclusivity). Weak models fail those constraints often
  // enough that the `cost` preference floors `commitSplit` at mini.
  const splitLlm = await getLlm(provider, splitService.model as LLMModel, { ...config, service: splitService })

  const INTERACTIVE = argv.interactive || isInteractive(config)
  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  } else {
    logger.setConfig({ quiet: true })
  }

  if (config.service.provider === 'ollama') {
    logger.verbose('⚠️  Ollama models may not strictly adhere to the output format instructions.', {
      color: 'yellow',
    })
  }

  logger.verbose(`→ ${provider} (${model})`, {
    color: 'green',
  })

  if (isCommitSplitCommand(argv)) {
    logger.verbose(
      `→ split planner: ${provider} (${splitService.model})`,
      { color: 'green' }
    )
    const splitResult = await handleCommitSplit({
      argv,
      config,
      git,
      logger,
      tokenizer,
      llm,
      planLlm: splitLlm,
      planService: splitService,
      interactive: INTERACTIVE,
    })

    const splitMode = INTERACTIVE ? 'interactive' : (config.mode || 'stdout')

    await handleResult({
      result: splitResult,
      mode: splitMode as 'interactive' | 'stdout',
      interactiveModeCallback: async (result) => {
        logger.log(result)
        logSuccess()
      },
    })
    logLlmTelemetrySummary(logger, 'commit')
    return
  }

  const USE_CONVENTIONAL_COMMITS = config.conventionalCommits || argv.conventional

  async function factory() {
    // noDiff and the regular path both need exactly the staged set — reusing
    // getChanges() here (instead of mapping raw `git status` entries) keeps
    // unstaged/untracked files out of the "Staged files" summary and
    // restores ignoredFiles/ignoredExtensions filtering for free (#1595).
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
    if (config.noDiff) {
      // When noDiff is enabled, just return a simple summary without parsing file contents
      const filesSummary = changes
        .map((change) => `${change.status}: ${change.filePath}`)
        .join('\n')
      return `Staged files:\n${filesSummary}`
    }

    return await fileChangeParser({
      changes,
      commit: '--staged',
      options: createFileChangeParserOptions({
        command: 'commit',
        tokenizer,
        git,
        llm: summaryLlm,
        logger,
        provider,
        model: String(summaryService.model),
        service: config.service,
      }),
    })
  }

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
    reviewParser: (result) => {
      // Ensure the result is properly formatted as a string for display
      return typeof result === 'string' ? result : String(result)
    },
    agent: async (context, options) => {
      // Select the appropriate schema based on whether conventional commits are enabled
      const schema = USE_CONVENTIONAL_COMMITS
        ? ConventionalCommitMessageResponseSchema
        : CommitMessageResponseSchema

      const formatInstructions = `CRITICAL: You must return ONLY a valid JSON object with no additional text, explanations, or markdown formatting.

REQUIRED JSON FORMAT:
${schema.description}

EXAMPLE (follow this EXACT format - compact JSON on a single line or minimal whitespace):
{"title": "feat(auth): add user authentication system", "body": "Implement JWT-based authentication with login and logout functionality. Includes password hashing and session management."}

IMPORTANT RULES:
- Return ONLY the JSON object - NO markdown code blocks, NO backticks, NO extra text
- ALL string values MUST be enclosed in double quotes
- Use compact JSON format (minimal whitespace) for best compatibility
- NO trailing commas
- NO comments or additional text outside the JSON
- The "title" and "body" values must be properly quoted strings`

      // Use conventional commit prompt if enabled
      const promptTemplate = USE_CONVENTIONAL_COMMITS ? CONVENTIONAL_COMMIT_PROMPT : COMMIT_PROMPT

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
      let shouldSkipCommitlintValidation = false
      
      if (USE_CONVENTIONAL_COMMITS || hasCommitLintConfig) {
        const { getCommitlintRulesContext, checkCommitlintAvailability } = await import('../../lib/utils/commitlintValidator')
        
        // Check if commitlint packages are available
        const availability = checkCommitlintAvailability()
        
        if (!availability.available) {
          const { handleMissingCommitlintDeps } = await import('../../lib/ui/handleMissingCommitlintDeps')
          const result = await handleMissingCommitlintDeps({
            logger,
            interactive: INTERACTIVE,
            missingPackages: availability.missingPackages,
          })

          switch (result.action) {
            case 'continue':
              shouldSkipCommitlintValidation = true
              logger.log('Continuing without commitlint validation...', { color: 'yellow' })
              break
            case 'setup':
              logger.log('\nPlease run `coco init` to set up commitlint, then try again.', { color: 'blue' })
              commandExit(0)
            case 'abort':
              logger.error('\nAborting commit operation.', { color: 'red' })
              commandExit(1)
          }
        } else {
          commitlint_rules_context = await getCommitlintRulesContext()
        }
      }

      // Get variables for the prompt
      const variables: Record<string, string> = {
        summary: context,
        format_instructions: formatInstructions,
        additional_context: additional_context,
        commit_history: commit_history,
        branch_name_context: branchNameContext,
        commitlint_rules_context: commitlint_rules_context,
        language_context: getLanguageContext(argv.language || config.language, {
          taskDescription: 'commit message',
          preserveConventionalTokens: USE_CONVENTIONAL_COMMITS,
        }),
      }

      const maxAttempts =
        config.service.provider === 'ollama' && 'maxParsingAttempts' in config.service
          ? config.service.maxParsingAttempts || 3
          : 3

      // Custom retry logic for commitlint validation
      let retryCount = 0
      let validationErrors = ''

      const generateCommitMessage = async (): Promise<string> => {
        // Update variables with validation errors for retry attempts
        const currentVariables = {
          ...variables,
          additional_context: validationErrors
            ? `${variables.additional_context}\n\n## Validation Errors from Previous Attempt\nPlease fix the following issues:\n${validationErrors}`
            : variables.additional_context,
        }

        const budgetedPrompt = await enforcePromptBudget({
          prompt,
          variables: currentVariables,
          tokenizer,
          maxTokens: config.service.tokenLimit || 2048,
        })

        if (budgetedPrompt.truncated) {
          logger.verbose(
            `Rendered prompt exceeded token budget; trimmed summary to ${budgetedPrompt.promptTokenCount} tokens.`,
            { color: 'yellow' }
          )
        }

        const commitMsg = await executeChainWithSchema(schema, llm, prompt, budgetedPrompt.variables, {
          logger,
          tokenizer,
          metadata: {
            task: USE_CONVENTIONAL_COMMITS ? 'commit-message-conventional' : 'commit-message',
            command: 'commit',
            provider,
            model: String(model),
          },
          retryOptions: {
            maxAttempts,
            onRetry: (attempt: number, error: Error) => {
              logger.verbose(
                `Failed to parse commit message (attempt ${attempt}/${maxAttempts}): ${error.message}`,
                { color: 'yellow' }
              )
            },
          },
          fallbackParser: salvageCommitMessageFromText,
          onFallback: () => {
            logger.verbose('Max retry attempts reached. Falling back to simple text output.', {
              color: 'red',
            })
          },
        })

        // Construct the full commit message using the utility function
        const ticketId = extractTicketIdFromBranchName(branchName)

        const fullMessage = formatCommitMessage(commitMsg, {
          append: argv.append,
          ticketId: ticketId || undefined,
          appendTicket: argv.appendTicket,
        })

        // If commitlint validation is needed and not skipped, validate the message
        if ((USE_CONVENTIONAL_COMMITS || hasCommitLintConfig) && !shouldSkipCommitlintValidation) {
          const { validateCommitMessage, CommitlintValidationError } = await import(
            '../../lib/utils/commitlintValidator'
          )
          const validationResult = await validateCommitMessage(fullMessage)

          logger.verbose(`Validation result: ${JSON.stringify(validationResult)}`, {
            color: 'yellow',
          })

          // Handle missing dependencies gracefully
          if (validationResult.missingDependencies && validationResult.missingDependencies.length > 0) {
            const { handleMissingCommitlintDeps } = await import('../../lib/ui/handleMissingCommitlintDeps')
            const result = await handleMissingCommitlintDeps({
              logger,
              interactive: INTERACTIVE,
              missingPackages: validationResult.missingDependencies,
            })

            switch (result.action) {
              case 'continue':
                logger.log('Skipping commitlint validation...', { color: 'yellow' })
                return fullMessage
              case 'setup':
                logger.log('\nPlease run `coco init` to set up commitlint, then try again.', { color: 'blue' })
                commandExit(0)
              case 'abort':
                logger.error('\nAborting commit due to missing dependencies.', { color: 'red' })
                commandExit(1)
            }
          }

          if (!validationResult.valid) {
            retryCount++
            // Format validation errors for next attempt
            validationErrors = validationResult.errors.map((error) => `- ${error}`).join('\n')

            // Auto-retry up to 2 times
            if (retryCount <= 2) {
              logger.verbose(
                `Commit message validation failed (attempt ${retryCount}/2). Retrying with error feedback...`,
                { color: 'yellow' }
              )
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

            logger.verbose(
              `Validation handler result: ${JSON.stringify(validationHandlerResult)}`,
              {
                color: 'blue',
              }
            )

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
                logger.error('\nAborting commit due to validation errors.', { color: 'red' })
                commandExit(1)
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
      const result = await withRetry(generateCommitMessage, {
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

      // Return the result which is already a properly formatted commit message string
      return result
    },
    noResult: async () => {
      await noResult({ git, logger })
      commandExit(0)
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  await handleResult({
    result: commitMsg as string,
    interactiveModeCallback: async (result) => {
      const noVerify = argv.noVerify || config.noVerify || false

      const attemptCommit = async (skipHooks: boolean): Promise<void> => {
        try {
          await createCommit(
            result,
            git,
            () => {
              logger.log(
                '⚠️  Pre-commit hook modified files. Staging changes and retrying commit...',
                { color: 'yellow' }
              )
            },
            { noVerify: skipHooks }
          )
          logSuccess()
        } catch (error) {
          if (error instanceof PreCommitHookError) {
            const choice = await promptHookFailureRecovery({
              logger,
              header: '✖ Commit blocked by pre-commit hook',
              hookOutput: error.hookOutput,
              interactive: INTERACTIVE,
            })

            if (choice === 'retry') {
              await attemptCommit(false)
            } else if (choice === 'skip') {
              logger.log('⚠️  Skipping hooks with --no-verify...', { color: 'yellow' })
              await attemptCommit(true)
            } else {
              if (INTERACTIVE) {
                logger.error('\nCommit aborted.', { color: 'red' })
              }
              commandExit(1)
            }
          } else {
            throw error
          }
        }
      }

      await attemptCommit(noVerify)
    },
    mode: MODE as 'interactive' | 'stdout',
  })
  logLlmTelemetrySummary(logger, 'commit')
}
