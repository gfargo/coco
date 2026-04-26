import { type TiktokenModel } from '@langchain/openai'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
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
import { getRepo } from '../../lib/simple-git/getRepo'
import { CommandHandler, FileChange } from '../../lib/types'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleResult } from '../../lib/ui/handleResult'
import { LOGO, isInteractive } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { fileChangeParser } from '../../lib/parsers/default'
import { getTokenCounter } from '../../lib/utils/tokenizer'
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

export const handler: CommandHandler<ChangelogArgv> = async (argv, logger) => {
  const config = loadConfig<ChangelogOptions, ChangelogArgv>(argv)
  const git = getRepo()
  const key = getApiKeyForModel(config)
  const { provider, model } = getModelAndProviderFromConfig(config)

  const exclusiveOptions = [
    argv.branch ? '--branch' : null,
    argv.tag ? '--tag' : null,
    config.sinceLastTag ? '--since-last-tag' : null,
  ].filter(Boolean)

  if (exclusiveOptions.length > 1) {
    logger.log(`Options ${exclusiveOptions.join(', ')} cannot be used together.`, { color: 'red' })
    process.exit(1)
  }

  if (config.service.authentication.type !== 'None' && !key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const llm = getLlm(provider, model, config)
  const tokenizer = await getTokenCounter(
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4o'
  )

  const INTERACTIVE = isInteractive(config)

  if (INTERACTIVE) {
    if (!config.hideCocoBanner) {
      logger.log(LOGO)
    }
  }

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
    } else if (config.range && config.range.includes(':')) {
      const [from, to] = config.range.split(':')
      if (!from || !to) {
        logger.log(`Invalid range provided. Expected format is <from>:<to>`, { color: 'red' })
        process.exit(1)
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
                    options: {
                      tokenizer,
                      git,
                      llm,
                      logger,
                      maxTokens: config.service.tokenLimit,
                      minTokensForSummary: config.service.minTokensForSummary,
                      maxFileTokens: config.service.maxFileTokens,
                      maxConcurrent: config.service.maxConcurrent,
                    },
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
        options: {
          tokenizer,
          git,
          llm,
          logger,
          maxTokens: config.service.tokenLimit,
          minTokensForSummary: config.service.minTokensForSummary,
          maxFileTokens: config.service.maxFileTokens,
          maxConcurrent: config.service.maxConcurrent,
        },
      })

      return `## Diff for ${data.branch}\n\n${diffSummary}`
    }

    if (!data.commits || data.commits.length === 0) {
      return `## ${data.branch}\n\nNo commits found.`
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
      const parser: any = createSchemaParser(ChangelogResponseSchema, llm)

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
      })

      const branchName = await getCurrentBranchName({ git })
      const ticketId = extractTicketIdFromBranchName(branchName)
      const footer = ticketId ? `\n\nPart of **${ticketId}**` : ''

      return `${changelog.title}\n\n${changelog.content}${footer}`
    },
    noResult: async () => {
      if (config.range) {
        logger.log(`No commits found in the provided range.`, { color: 'red' })
        process.exit(0)
      }

      logger.log(`No commits found in the current branch.`, { color: 'red' })
      process.exit(0)
    },
  })

  const MODE =
    (INTERACTIVE && 'interactive') || (config.commit && 'interactive') || config?.mode || 'stdout'

  handleResult({
    result: changelogMsg,
    interactiveModeCallback: async () => {
      logSuccess()
    },
    mode: MODE as 'interactive' | 'stdout',
  })
}
