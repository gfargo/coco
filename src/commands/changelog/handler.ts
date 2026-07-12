import { LLMModel } from '../../lib/langchain/types'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { logLlmTelemetrySummary } from '../../lib/langchain/utils/observability'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { extractTicketIdFromBranchName } from '../../lib/simple-git/extractTicketIdFromBranchName'
import { getChangesSinceLastTag } from '../../lib/simple-git/getChangesSinceLastTag'
import { getCommitLogAgainstBranch } from '../../lib/simple-git/getCommitLogAgainstBranch'
import { getCommitLogAgainstTag } from '../../lib/simple-git/getCommitLogAgainstTag'
import { getCommitLogCurrentBranch } from '../../lib/simple-git/getCommitLogCurrentBranch'
import { getCommitLogRangeDetails, CommitDetails } from '../../lib/simple-git/getCommitLogRangeDetails'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getChangesByCommit } from '../../lib/simple-git/getChangesByCommit'
import { CommandHandler, FileChange } from '../../lib/types'
import { applyRepoCwd, applyRepoFlag } from '../utils/applyRepoFlag'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { handleResult } from '../../lib/ui/handleResult'
import { emitJson } from '../../lib/ui/emitJson'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import {
    ChangelogArgv,
    ChangelogOptions,
    ChangelogResponse,
    ChangelogResponseSchema,
} from './config'
import { CHANGELOG_PROMPT } from './prompt'

type CommitDetailsWithDiffText = CommitDetails & { diffText?: string };

type FactoryResult = {
  branch: string;
  commits?: CommitDetailsWithDiffText[];
  diffChanges?: FileChange[];
  diffCommit?: string;
  withDiff?: boolean;
}

async function processInWaves<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent = 6
): Promise<R[]> {
  const results: R[] = []
  const limit = Math.max(1, maxConcurrent)

  for (let i = 0; i < items.length; i += limit) {
    const waveResults = await Promise.all(items.slice(i, i + limit).map(processor))
    results.push(...waveResults)
  }

  return results
}

/**
 * Core changelog generation logic — produces the changelog text and
 * optional structured response without performing any I/O (no stdout
 * writes, no banner, no handleResult).
 *
 * Extracted so that non-CLI callers (e.g. the TUI workstation) can call
 * this directly and get the result back as a value, instead of having to
 * monkey-patch process.stdout.write to capture the output (which collides
 * with the live Ink renderer and corrupts the TUI display).
 *
 * Throws CommandExitError when there are no commits (same behaviour as
 * the interactive handler — callers should catch and treat as an empty
 * result).
 */
export async function generateChangelogResult(
  argv: ChangelogArgv,
  logger: Parameters<CommandHandler<ChangelogArgv>>[1],
  // Optional user-cancellation signal (#1338). Threaded into the
  // changelog `executeChain` call so the workstation's Esc-cancel can
  // tear down the in-flight LLM request; aborts surface as
  // `LangChainCancelledError`.
  options: { signal?: AbortSignal } = {}
): Promise<{ text: string; structured: ChangelogResponse | undefined }> {
  // Captured up front: the `agent` callback below has its own `options`
  // parameter (the review-loop options), which would shadow this one.
  const cancelSignal = options.signal
  const git = applyRepoFlag(argv)
  const config = loadConfig<ChangelogOptions, ChangelogArgv>(argv)
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const changelogService = resolveDynamicService(config, 'changelog')
  const summaryService = resolveDynamicService(config, argv.withDiff || argv.onlyDiff ? 'largeDiff' : 'summarize')
  const model = changelogService.model

  const exclusiveOptions = [
    argv.branch ? '--branch' : null,
    argv.tag ? '--tag' : null,
    config.sinceLastTag ? '--since-last-tag' : null,
    config.range ? '--range' : null,
  ].filter(Boolean)

  if (exclusiveOptions.length > 1) {
    logger.error(`Options ${exclusiveOptions.join(', ')} cannot be used together.`, { color: 'red' })
    commandExit(1)
  }

  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'changelog' })
  }

  // Mirrors the pattern in recap/handler.ts: never let git/LLM status
  // chrome leak onto stdout in non-interactive mode, since that's the
  // same stream `--json` output (or a redirected `> CHANGELOG.md`) uses.
  const INTERACTIVE = argv.json ? false : isInteractive(config)
  if (!INTERACTIVE) {
    logger.setConfig({ silent: true })
  }

  const llm = getLlm(provider, model as LLMModel, { ...config, service: changelogService })
  const summaryLlm = getLlm(provider, summaryService.model as LLMModel, { ...config, service: summaryService })
  const tokenizer = await getTokenCounterForProvider(provider, String(model))

  let structured: ChangelogResponse | undefined

  async function factory(): Promise<FactoryResult> {
    const branchName = await getCurrentBranchName({ git })

    if (argv.onlyDiff) {
      const baseBranch = argv.branch || config.defaultBranch || 'main'
      logger.verbose(`Generating changelog based on branch diff`, { color: 'yellow' })
      const diff = await getDiffForBranch({ git, logger, baseBranch, headBranch: branchName })
      return {
        branch: branchName,
        diffChanges: diff.staged,
        diffCommit: `${baseBranch}..${branchName}`,
      }
    }

    let commits: CommitDetails[] = []

    if (config.sinceLastTag) {
      logger.verbose(`Generating commit log since the last tag`, { color: 'yellow' })
      // This function returns string[], needs to be adapted or replaced
      // For now, this path will have limited details.
      const commitMessages = await getChangesSinceLastTag({ git, logger })
      commits = commitMessages.map(msg => ({ message: msg })) as CommitDetails[]
    } else if (config.range) {
      // Accept both coco's `<from>:<to>` and git's native `<from>..<to>` /
      // `<from>...<to>` range syntax — a bare `--range HEAD~5..HEAD` used
      // to fail this guard silently and fall through to current-branch
      // mode with no warning (#1590).
      const [from, to] = config.range.split(/:|\.{2,3}/)
      if (!from || !to) {
        logger.error(`Invalid range provided. Expected format is <from>:<to> (or <from>..<to>)`, { color: 'red' })
        commandExit(1)
      }
      commits = await getCommitLogRangeDetails(from, to, { git, noMerges: true })
    } else if (argv.branch) {
      logger.verbose(`Generating commit log against branch: ${argv.branch}`, { color: 'yellow' })
      commits = await getCommitLogAgainstBranch({ git, logger, targetBranch: argv.branch })
    } else if (argv.tag) {
      logger.verbose(`Generating commit log against tag: ${argv.tag}`, { color: 'yellow' })
      commits = await getCommitLogAgainstTag({ git, logger, targetTag: argv.tag })
    } else {
      logger.verbose(`No range, branch, or tag option provided. Defaulting to current branch`,
        {
          color: 'yellow',
        }
      )
      commits = await getCommitLogCurrentBranch({ git, logger })
    }

    let commitsWithDiffText: CommitDetailsWithDiffText[] = commits;
    if (argv.withDiff) {
      commitsWithDiffText = await processInWaves(
        commits,
        async (commit) => {
          const changes = await getChangesByCommit({
            commit: commit.hash,
            options: {
              git,
              logger,
              ignoredFiles: config.ignoredFiles || undefined,
              ignoredExtensions: config.ignoredExtensions || undefined,
            },
          })

          return {
            ...commit,
            diffText:
              changes.length > 0
                ? await fileChangeParser({
                    changes,
                    commit: `${commit.hash}^..${commit.hash}`,
                    options: createFileChangeParserOptions({
                      command: 'changelog',
                      tokenizer,
                      git,
                      llm: summaryLlm,
                      logger,
                      provider,
                      model: String(summaryService.model),
                      service: config.service,
                    }),
                  })
                : undefined,
          }
        },
        config.service.maxConcurrent
      );
    }

    return {
      branch: branchName,
      commits: commitsWithDiffText,
      withDiff: argv.withDiff,
    }
  }

  async function parser(data: FactoryResult) {
    if (data.diffChanges && data.diffCommit) {
      const diffSummary = await fileChangeParser({
        changes: data.diffChanges,
        commit: data.diffCommit,
        options: createFileChangeParserOptions({
          command: 'changelog',
          tokenizer,
          git,
          llm: summaryLlm,
          logger,
          provider,
          model: String(summaryService.model),
          service: config.service,
        }),
      })

      return `## Diff for ${data.branch}\n\n${diffSummary}`
    }

    if (!data.commits || data.commits.length === 0) {
      // Short-circuit with an empty context so the review loop drops
      // into `noResult` instead of spending an LLM call summarising
      // "No commits found." into a fake changelog entry. The
      // upstream helper (getCommitLogCurrentBranch) already logged
      // the reason (detached HEAD, missing comparison ref, branch at
      // baseline, etc.) in a friendly status line.
      return ''
    }

    let result = `## ${data.branch}\n\n`
    result += data.commits.map(commit => {
      let commitStr = `Author: ${commit.author_name}\nCommit: ${commit.hash}\nMessage: ${commit.message}\n${commit.body}`
      if (data.withDiff && commit.diffText) {
        commitStr += `\nDiff:\n${commit.diffText}`
      }
      return commitStr.trim()
    }).join('\n\n---\n\n')
    
    return result
  }

  const changelogMsg = await generateAndReviewLoop<FactoryResult, string>({
    label: 'changelog',
    options: {
      ...config,
      prompt: config.prompt || (CHANGELOG_PROMPT.template as string),
      logger,
      interactive: INTERACTIVE,
      review: {
        enableFullRetry: false,
      },
    },
    factory,
    parser,
    agent: async (context, options) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser: any = createSchemaParser(ChangelogResponseSchema)

      const prompt = getPrompt({
        template: options.prompt,
        variables: CHANGELOG_PROMPT.inputVariables,
        fallback: CHANGELOG_PROMPT,
      })

      const formatInstructions =
        "Only respond with a valid JSON object, containing two fields: 'title' an escaped string, no more than 65 characters, and 'content' also an escaped string."
      
      let additional_context = ''
      if (argv.additional) {
        additional_context = `## Additional Context\n${argv.additional}`
      }

      const author_instructions = argv.author
        ? 'At the end of each item, attribute the author and include a reference to the commit hash, like this: `by @author_name (f6dbe61)`. Use the first 7 characters of the hash.'
        : 'At the end of each item, include a reference to the commit hash, like this: `(f6dbe61)`. Use the first 7 characters of the hash.'

      const variables = {
        summary: context,
        format_instructions: formatInstructions,
        additional_context: additional_context,
        author_instructions: author_instructions,
      }

      const budgetedPrompt = await enforcePromptBudget({
        prompt,
        variables,
        tokenizer,
        maxTokens: config.service.tokenLimit || 2048,
      })

      if (budgetedPrompt.truncated) {
        logger.verbose(
          `Rendered prompt exceeded token budget; trimmed summary to ${budgetedPrompt.promptTokenCount} tokens.`,
          { color: 'yellow' }
        )
      }

      const changelog = await executeChain<ChangelogResponse>({
        llm,
        prompt,
        variables: budgetedPrompt.variables,
        parser,
        logger,
        tokenizer,
        signal: cancelSignal,
        metadata: {
          task: argv.withDiff ? 'changelog-with-diff' : argv.onlyDiff ? 'changelog-only-diff' : 'changelog',
          command: 'changelog',
          provider,
          model: String(model),
        },
      })

      const branchName = await getCurrentBranchName({ git })
      const ticketId = extractTicketIdFromBranchName(branchName)
      const footer = ticketId ? `\n\nPart of **${ticketId}**` : ''

      structured = { title: changelog.title, content: `${changelog.content}${footer}` }

      return `${changelog.title}\n\n${changelog.content}${footer}`
    },
    noResult: async () => {
      if (config.range) {
        logger.log(`No commits found in the provided range.`, { color: 'yellow' })
        if (argv.json) emitJson(null)
        commandExit(0)
      }

      // Yellow rather than red — for the no-commits-on-current-branch
      // case the upstream helper has already explained the reason in
      // a friendly status line (detached HEAD, no comparison ref,
      // branch at baseline). This is the trailing summary, not an
      // error.
      logger.log(`No commits found in the current branch.`, { color: 'yellow' })
      if (argv.json) emitJson(null)
      commandExit(0)
    },
  })

  return { text: changelogMsg, structured }
}

/**
 * CLI entrypoint — thin I/O wrapper around generateChangelogResult.
 * Handles the banner, --json output, interactive/stdout mode, and
 * telemetry summary. All heavy lifting (git, LLM, prompt) is in the
 * core function above.
 */
export const handler: CommandHandler<ChangelogArgv> = async (argv, logger) => {
  // #1626 — chdir to the --repo target BEFORE loadConfig, so the
  // banner/mode decision below reads the target repo's config instead of
  // the launcher directory's. generateChangelogResult's own applyRepoFlag
  // call re-resolves the same (already-current) directory, a no-op.
  applyRepoCwd(argv)
  const config = loadConfig<ChangelogOptions, ChangelogArgv>(argv)
  const INTERACTIVE = argv.json ? false : isInteractive(config)

  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  }

  const { text: changelogMsg, structured } = await generateChangelogResult(argv, logger)

  if (argv.json) {
    emitJson(structured ?? null)
    return
  }

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  handleResult({
    result: changelogMsg,
    interactiveModeCallback: async () => {
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
  logLlmTelemetrySummary(logger, 'changelog')
}
