import { JsonOutputParser } from '@langchain/core/output_parsers'
import { type TiktokenModel } from '@langchain/openai'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { executeChain } from '../../lib/langchain/utils/executeChain'
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
import { CommitArgv, CommitMessageResponse, CommitOptions } from './config'
import { noResult } from './noResult'
import { COMMIT_PROMPT } from './prompt'

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
    logger.log(LOGO)
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
      prompt: config.prompt || (COMMIT_PROMPT.template as string),
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
      const parser = new JsonOutputParser<CommitMessageResponse>()

      const prompt = getPrompt({
        template: options.prompt,
        variables: COMMIT_PROMPT.inputVariables,
        fallback: COMMIT_PROMPT,
      })

      const formatInstructions =
        "Respond with a valid JSON object, containing two fields: 'title' and 'body', both strings."

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
          count: argv.withPreviousCommits
        })
        
        if (commitHistoryData) {
          commit_history = `## Commit History\n${commitHistoryData}`
        }
      }

      const commitMsg = await executeChain({
        llm,
        prompt,
        variables: {
          summary: context,
          format_instructions: formatInstructions,
          additional_context: additional_context,
          commit_history: commit_history,
        },
        parser,
      })

      const appendedText = argv.append ? `\n\n${argv.append}` : ''

      const branchName = await getCurrentBranchName({ git })
      const ticketId = extractTicketIdFromBranchName(branchName)
      const ticketFooter = argv.appendTicket && ticketId ? `\n\nPart of **${ticketId}**` : ''

      return `${commitMsg.title}\n\n${commitMsg.body}${appendedText}${ticketFooter}`
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
