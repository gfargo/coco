import { LLMModel } from '../../lib/langchain/types'
import chalk from 'chalk'
import { z } from 'zod'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getProviderOverview } from '../../git/providerData'
import { getForgeActions } from '../../git/forgeActions'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { logLlmTelemetrySummary } from '../../lib/langchain/utils/observability'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { getLanguageContext } from '../../lib/langchain/utils/languageContext'
import { fileChangeParser } from '../../lib/parsers/default/index'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { emitJson } from '../../lib/ui/emitJson'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { isInteractive, LOGO, severityColor } from '../../lib/ui/helpers'
import { TaskList } from '../../lib/ui/TaskList'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
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

function formatFindings(findings: ReviewFeedbackItem[]): string {
  return findings
    .map((task: ReviewFeedbackItem) => {
      const color = severityColor(task.severity)
      return color(
        `[${task.severity}] ${chalk.bold(task.title)} (${task.category})\n ${chalk.dim(
          `→ "${task.filePath}"`
        )}`
      )
    })
    .join('\n\n')
}

// Plain-markdown rendering for posting to a forge PR/MR comment — no ANSI
// color codes, since those render as literal escape sequences on GitHub/GitLab.
function formatFindingsMarkdown(findings: ReviewFeedbackItem[]): string {
  if (findings.length === 0) {
    return 'coco review found no issues.'
  }
  return findings
    .map((task) => `- **[${task.severity}] ${task.title}** (${task.category}) — \`${task.filePath}\`\n  ${task.summary}`)
    .join('\n')
}

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

  const tokenizer = await getTokenCounterForProvider(provider, String(model))

  const llm = await getLlm(provider, model as LLMModel, { ...config, service: reviewService })
  const summaryLlm = await getLlm(provider, summaryService.model as LLMModel, { ...config, service: summaryService })

  const INTERACTIVE = argv.json ? false : (argv.interactive || isInteractive(config))
  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  } else if (argv.json) {
    // JSON output is data on stdout; silence human log lines so they can't
    // pollute the machine-readable payload (mirrors recap #1586).
    logger.setConfig({ quiet: true })
  }

  // `--pr <n>`: review an existing forge PR/MR instead of local changes.
  // Resolved once up front so both the diff-fetch (factory) and the
  // optional `--comment` post-review step share the same forge instance.
  const forge = argv.pr !== undefined
    ? await (async () => {
        const overview = await getProviderOverview(git)
        const forgeProvider = overview.repository.provider
        const repoPath =
          overview.repository.owner && overview.repository.name
            ? `${overview.repository.owner}/${overview.repository.name}`
            : undefined
        return getForgeActions(forgeProvider, {
          gitlabPath: repoPath,
          gitlabHost: overview.repository.host,
          bitbucketPath: repoPath,
          giteaPath: repoPath,
          giteaHost: overview.repository.host,
        })
      })()
    : undefined

  async function factory() {
    if (argv.pr !== undefined) {
      logger.verbose(`Fetching diff for PR/MR #${argv.pr}`, { color: 'yellow' })

      const diffResult = await forge!.getPullRequestDiffByNumber(argv.pr)
      if (!diffResult.ok) {
        logger.error(diffResult.message, { color: 'red' })
        commandExit(1)
      }
      if (diffResult.lines.length === 0) {
        logger.log(`No diff found for PR/MR #${argv.pr}. Exiting...`)
        commandExit(0)
      }

      return [diffResult.lines.join('\n')]
    }

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
        if (argv.json) emitJson([])
        commandExit(0)
      }

      if (INTERACTIVE) {
        logger.verbose(
          `Staged: ${staged.length}, Unstaged: ${unstaged?.length || 0}, Untracked: ${
            untracked?.length || 0
          }`
        )
      }

      // `--staged`: scope the review to staged changes only (the
      // pre-commit / CI-gating shape) instead of the whole worktree.
      if (argv.staged) {
        if (staged.length === 0) {
          logger.log('No staged changes detected. Exiting...')
          if (argv.json) emitJson([])
          commandExit(0)
        }
        const stagedOnly = await fileChangeParser({
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
        return [`Staged changes:\n${stagedOnly}`]
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

  // `generateAndReviewLoop`'s non-interactive branch overwrites its returned
  // result with the `reviewParser`-formatted display string (by design, for
  // callers whose R is already string-shaped). Review's R is a structured
  // array, so capture it directly from the agent instead of trusting the
  // loop's return value.
  let capturedFindings: ReviewFeedbackItem[] = []

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
      const parser: any = createSchemaParser(ReviewFeedbackResponseSchema)

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
        language_context: getLanguageContext(argv.language || config.language, { taskDescription: 'code review feedback' }),
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
          task: argv.pr !== undefined ? 'review-pr' : argv.branch ? 'review-branch' : 'review',
          command: 'review',
          provider,
          model: String(model),
        },
      }) as ReviewFeedbackItem[]

      // sort by severity
      const sorted = response.sort((a: ReviewFeedbackItem, b: ReviewFeedbackItem) => b.severity - a.severity)
      capturedFindings = sorted
      return sorted
    },
    reviewParser(result: ReviewFeedbackItem[]) {
      return formatFindings(result)
    },
    noResult: async () => {
      await noResult({ git, logger })
      if (argv.json) emitJson([])
      commandExit(0)
    },
  })

  const findings = Array.isArray(recap) ? recap : capturedFindings

  // `--severity <n>`: CI gate. After surfacing the review, exit non-zero
  // if any finding is at or above the threshold so pipelines can block on it.
  // Defense-in-depth alongside the builder's `.check()` validation:
  // Number.isFinite(NaN) is false, unlike `typeof NaN === 'number'` (#1599).
  const severityThreshold = Number.isFinite(argv.severity) ? argv.severity : undefined
  const exceedsThreshold =
    severityThreshold !== undefined && findings.some((f) => f.severity >= severityThreshold)

  // `--comment`: post the findings to the PR/MR (requires `--pr`, enforced by
  // the builder's `.check()`). Findings meeting `--severity` request changes
  // instead of a plain comment, mirroring the CI-gating semantics above.
  if (argv.comment && argv.pr !== undefined && forge) {
    const body = formatFindingsMarkdown(findings)
    const postResult = exceedsThreshold
      ? await forge.requestChangesPullRequestByNumber(argv.pr, body)
      : await forge.commentPullRequestByNumber(argv.pr, body)

    if (postResult.ok) {
      logger.log(postResult.message, { color: 'green' })
    } else {
      logger.error(postResult.message, { color: 'red' })
    }
  }

  if (argv.json) {
    emitJson(findings)
    if (exceedsThreshold) {
      commandExit(1)
    }
    return
  }

  const canShowTaskList = process.stdin.isTTY && process.stdout.isTTY
  if (!canShowTaskList) {
    logger.log(chalk.bold('Review findings:\n'))
    logger.log(formatFindings(findings))
    logger.log(chalk.dim('\nNon-interactive session detected — re-run with --json for machine-readable output.'))
  } else {
    const reviewer = new TaskList(findings, { ...config, apiKey: key ?? undefined })
    logLlmTelemetrySummary(logger, 'review')
    await reviewer.start()
  }

  if (exceedsThreshold) {
    logger.log(
      `Review found ${findings.filter((f) => f.severity >= severityThreshold!).length} finding(s) at or above severity ${severityThreshold}.`,
      { color: 'red' }
    )
    commandExit(1)
  }
}
