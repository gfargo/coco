import { TiktokenModel } from '@langchain/openai'
import { LLMModel } from '../../lib/langchain/types'
import chalk from 'chalk'
import { z } from 'zod'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { logLlmTelemetrySummary } from '../../lib/langchain/utils/observability'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { fileChangeParser } from '../../lib/parsers/default/index'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { isInteractive, LOGO, severityColor } from '../../lib/ui/helpers'
import { TaskList } from '../../lib/ui/TaskList'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { ReviewArgv, ReviewFeedbackItemArraySchema, ReviewOptions, ReviewFeedbackItem } from './config'
import { noResult } from './noResult'
import { REVIEW_PROMPT } from './prompt'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'

// Some review prompts still produce a single feedback object. Normalize that shape
// so the parser always returns an array for the rest of the review flow.
const ReviewFeedbackResponseSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : [value]),
  ReviewFeedbackItemArraySchema
)

export const handler: CommandHandler<ReviewArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const config = loadConfig<ReviewOptions, ReviewArgv>(argv)
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const reviewService = resolveDynamicService(config, 'review')
  const summaryService = resolveDynamicService(config, argv.branch ? 'largeDiff' : 'summarize')
  const model = reviewService.model

  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'review' })
  }

  const tokenizer = await getTokenCounter(
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4o'
  )

  const llm = getLlm(provider, model as LLMModel, { ...config, service: reviewService })
  const summaryLlm = getLlm(provider, summaryService.model as LLMModel, { ...config, service: summaryService })

  const INTERACTIVE = argv.interactive || isInteractive(config)
  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  }

  async function factory() {
    if (argv.branch) {
      logger.verbose(`Generating diff for branch: ${argv.branch}`, { color: 'yellow' })

      const currentBranch = await getCurrentBranchName({ git })
      const diff = await getDiffForBranch({
        git,
        logger,
        baseBranch: argv.branch,
        headBranch: currentBranch,
        options: {
          ignoredFiles: config.ignoredFiles || [],
          ignoredExtensions: config.ignoredExtensions || [],
        },
      })

      const branchChanges = await fileChangeParser({
        changes: diff.staged,
        commit: `${argv.branch}..${currentBranch}`,
        options: createFileChangeParserOptions({
          command: 'review',
          tokenizer,
          git,
          llm: summaryLlm,
          logger,
          provider,
          model: String(summaryService.model),
          service: config.service,
        }),
      })

      return [branchChanges]
    } else {
      const { staged, unstaged, untracked } = await getChanges({
        git,
        options: {
          ignoredFiles: config.ignoredFiles || undefined,
          ignoredExtensions: config.ignoredExtensions || undefined,
        },
      })

      if (staged.length === 0 && unstaged?.length === 0 && untracked?.length === 0) {
        logger.log('No changes detected. Exiting...')
        commandExit(0)
      }

      if (INTERACTIVE) {
        logger.verbose(
          `Staged: ${staged.length}, Unstaged: ${unstaged?.length || 0}, Untracked: ${
            untracked?.length || 0
          }`
        )
      }

      const unstagedChanges = await fileChangeParser({
        changes: unstaged || [],
        commit: '--unstaged',
        options: createFileChangeParserOptions({
          command: 'review',
          tokenizer,
          git,
          llm: summaryLlm,
          logger,
          provider,
          model: String(summaryService.model),
          service: config.service,
        }),
      })

      const unstagedResponse = `Unstaged changes:\n${unstagedChanges}`

      const untrackedChanges = await fileChangeParser({
        changes: untracked || [],
        commit: '--untracked',
        options: createFileChangeParserOptions({
          command: 'review',
          tokenizer,
          git,
          llm: summaryLlm,
          logger,
          provider,
          model: String(summaryService.model),
          service: config.service,
        }),
      })
      const untrackedResponse = `Untracked changes:\n${untrackedChanges}`

      const stagedChanges = await fileChangeParser({
        changes: staged,
        commit: '--staged',
        options: createFileChangeParserOptions({
          command: 'review',
          tokenizer,
          git,
          llm: summaryLlm,
          logger,
          provider,
          model: String(summaryService.model),
          service: config.service,
        }),
      })
      const stagedResponse = `Staged changes:\n${stagedChanges}`

      return [unstagedResponse, untrackedResponse, stagedResponse]
    }
  }

  async function parser(changes: string[]) {
    return changes.join('\n')
  }

  const recap = await generateAndReviewLoop<string[], ReviewFeedbackItem[]>({
    label: 'review',
    options: {
      ...config,
      prompt: config.prompt || (REVIEW_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        selectLabel: 'Review the proposed feedback before starting',
        enableModifyPrompt: false,
        enableEdit: false,
        descriptions: {
          retryMessageOnly: 'Create new code review based on the same diff summary',
          retryFull:
            'Restart the function execution from the beginning, regenerating both the diff summary and code review',
        },
        labels: {
          approve: '✨ Begin review',
        },
      },
    },
    factory,
    parser,
    agent: async (context, options) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser: any = createSchemaParser(ReviewFeedbackResponseSchema, llm)

      const formatInstructions =
        "Respond with a valid JSON object, containing four fields:'title' a string, 'summary' a short summary of the problem (include line number if big file), 'severity' a numeric enum up to ten, 'category' an enum string, and 'filePath' a relative filepath to file as string."

      const prompt = getPrompt({
        template: options.prompt,
        variables: REVIEW_PROMPT.inputVariables,
        fallback: REVIEW_PROMPT,
      })

      const variables = {
        changes: context,
        format_instructions: formatInstructions,
      }
      const budgetedPrompt = await enforcePromptBudget({
        prompt,
        variables,
        tokenizer,
        maxTokens: config.service.tokenLimit || 2048,
        summaryKey: 'changes',
      })

      if (budgetedPrompt.truncated) {
        logger.verbose(
          `Rendered prompt exceeded token budget; trimmed changes to ${budgetedPrompt.promptTokenCount} tokens.`,
          { color: 'yellow' }
        )
      }

      const response = await executeChain({
        llm,
        prompt,
        variables: budgetedPrompt.variables,
        parser,
        logger,
        tokenizer,
        metadata: {
          task: argv.branch ? 'review-branch' : 'review',
          command: 'review',
          provider,
          model: String(model),
        },
      }) as ReviewFeedbackItem[]

      // sort by severity
      return response.sort((a: ReviewFeedbackItem, b: ReviewFeedbackItem) => b.severity - a.severity)
    },
    reviewParser(result: ReviewFeedbackItem[]) {
      return result
        .map((task: ReviewFeedbackItem) => {
          const color = severityColor(task.severity)
          return color(
            `[${task.severity}] ${chalk.bold(task.title)} (${task.category})\n ${chalk.dim(
              `→ "${task.filePath}"`
            )}`
          )
        })
        .join('\n\n')
    },
    noResult: async () => {
      await noResult({ git, logger })
      commandExit(0)
    },
  })

  const reviewer = new TaskList(recap as ReviewFeedbackItem[], { ...config, apiKey: key ?? undefined })
  logLlmTelemetrySummary(logger, 'review')
  await reviewer.start()
}
