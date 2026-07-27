import { z } from 'zod'
import { getBlame } from '../../git/blameData'
import { getCommitDetail, GitCommitDetail } from '../../git/logData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { LLMModel } from '../../lib/langchain/types'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLanguageContext } from '../../lib/langchain/utils/languageContext'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { handleResult } from '../../lib/ui/handleResult'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { BlameArgv, BlameOptions } from './config'
import { BLAME_EXPLAIN_PROMPT } from './prompt'
import {
  BlameExplainEntry,
  filterBlameLines,
  formatBlameJson,
  formatBlameTable,
  formatCommitContext,
  formatExplanations,
  formatLineRanges,
  groupLinesByHash,
  parseLineRange,
} from './render'

// `git blame`'s all-zero sha for uncommitted/staged lines — there is no
// commit to fetch or explain, so these are always excluded from --explain.
const UNCOMMITTED_SHA = '0'.repeat(40)

// Cost guardrails (#OSS-1604): naive --explain would issue one LLM call per
// blamed sha. We batch into a single call, but still cap the input so a
// huge file (or an un-narrowed --lines) can't balloon the prompt/cost.
const MAX_EXPLAIN_LINES = 400
const MAX_EXPLAIN_COMMITS = 25

const BlameExplainResponseSchema = z.array(
  z.object({
    hash: z.string(),
    explanation: z.string(),
  })
)

export const handler: CommandHandler<BlameArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  const range = parseLineRange(argv.lines)
  if (argv.lines && !range) {
    const message = `Invalid --lines value "${argv.lines}". Expected "a:b", "a:", or "a".`
    if (argv.json) {
      emitJson({ error: message })
      commandExit(1)
    }
    logger.error(message, { color: 'red' })
    commandExit(1)
  }

  const result = await getBlame(git, argv.file)

  if (!result.ok) {
    if (argv.json) {
      emitJson({ error: result.message })
      commandExit(1)
    }
    logger.error(result.message, { color: 'red' })
    commandExit(1)
  }

  const lines = filterBlameLines(result.lines, range)

  if (lines.length === 0) {
    const message = `No blame lines found for "${argv.file}"${range ? ` in the requested range` : ''}.`
    if (argv.json) {
      emitJson({ path: result.path, lines: [] })
      return
    }
    await handleResult({ result: message, mode: 'stdout' })
    return
  }

  if (!argv.explain) {
    const output = argv.json ? formatBlameJson(result.path, lines) : formatBlameTable(lines)
    await handleResult({ result: output, mode: 'stdout' })
    return
  }

  // --explain: resolve the introducing commits and ask the LLM why each
  // range was written. Only this branch touches config/LLM plumbing, so
  // plain `coco blame` never requires an API key.
  const config = loadConfig<BlameOptions, BlameArgv>(argv)
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)

  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'blame' })
  }

  if (lines.length > MAX_EXPLAIN_LINES) {
    const message = `--explain covers ${lines.length} lines, which exceeds the ${MAX_EXPLAIN_LINES}-line cap. Narrow the range with --lines a:b and try again.`
    if (argv.json) {
      emitJson({ error: message })
      commandExit(1)
    }
    logger.error(message, { color: 'red' })
    commandExit(1)
  }

  const groups = groupLinesByHash(lines).filter((group) => group.hash !== UNCOMMITTED_SHA)

  if (groups.length === 0) {
    const message = 'All lines in range are uncommitted — nothing to explain.'
    if (argv.json) {
      emitJson({ path: result.path, lines, explanations: [] })
      return
    }
    await handleResult({ result: `${formatBlameTable(lines)}\n\n${message}`, mode: 'stdout' })
    return
  }

  const truncated = groups.length > MAX_EXPLAIN_COMMITS
  const explainedGroups = truncated ? groups.slice(0, MAX_EXPLAIN_COMMITS) : groups

  const service = resolveDynamicService(config, 'blameExplain')
  const model = service.model
  const tokenizer = await getTokenCounterForProvider(provider, String(model))
  const llm = await getLlm(provider, model as LLMModel, { ...config, service })

  const details = await Promise.all(
    explainedGroups.map((group) => getCommitDetail(git, group.hash))
  )
  const detailByHash = new Map<string, GitCommitDetail>(
    explainedGroups.map((group, index) => [group.hash, details[index]])
  )

  const commitsContext = explainedGroups
    .map((group) =>
      formatCommitContext({
        hash: group.hash,
        lineNumbers: group.lineNumbers,
        detail: detailByHash.get(group.hash)!,
      })
    )
    .join('\n\n---\n\n')

  const formatInstructions =
    "Respond with a valid JSON array of objects, each containing 'hash' (the full commit sha exactly as given above) and 'explanation' (1-3 sentences), one entry per commit listed."

  const prompt = getPrompt({
    template: config.prompt || (BLAME_EXPLAIN_PROMPT.template as string),
    variables: BLAME_EXPLAIN_PROMPT.inputVariables,
    fallback: BLAME_EXPLAIN_PROMPT,
  })

  const variables = {
    file: result.path,
    format_instructions: formatInstructions,
    commits: commitsContext,
    language_context: getLanguageContext(config.language, {
      taskDescription: 'explanation',
    }),
  }

  const budgetedPrompt = await enforcePromptBudget({
    prompt,
    variables,
    tokenizer,
    maxTokens: config.service.tokenLimit || 2048,
    summaryKey: 'commits',
  })

  if (budgetedPrompt.truncated) {
    logger.verbose(
      `Rendered prompt exceeded token budget; trimmed commit context to ${budgetedPrompt.promptTokenCount} tokens.`,
      { color: 'yellow' }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parser: any = createSchemaParser(BlameExplainResponseSchema)

  let explanationByHash = new Map<string, string>()
  let agentError: Error | undefined

  try {
    const response = await executeChain<z.infer<typeof BlameExplainResponseSchema>>({
      llm,
      prompt,
      variables: budgetedPrompt.variables,
      parser,
      logger,
      tokenizer,
      metadata: {
        task: 'blameExplain',
        command: 'blame',
        provider,
        model: String(model),
      },
    })
    explanationByHash = new Map(response.map((entry) => [entry.hash, entry.explanation]))
  } catch (error) {
    agentError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to generate blame explanations: ${agentError.message}`, { color: 'red' })
  }

  const entries: BlameExplainEntry[] = explainedGroups.map((group) => ({
    ...group,
    detail: detailByHash.get(group.hash)!,
    explanation: explanationByHash.get(group.hash) || 'No explanation returned by the model.',
  }))

  if (argv.json) {
    emitJson({
      path: result.path,
      lines,
      explanations: entries.map((entry) => ({
        hash: entry.hash,
        shortHash: entry.shortHash,
        author: entry.author,
        lines: formatLineRanges(entry.lineNumbers),
        subject: entry.detail.message,
        explanation: entry.explanation,
      })),
      truncated,
      ...(agentError ? { error: agentError.message } : {}),
    })
    if (agentError) commandExit(1)
    return
  }

  const notice = truncated
    ? `\n\nNote: ${groups.length} distinct commits touch this range; only the first ${MAX_EXPLAIN_COMMITS} were explained.`
    : ''

  await handleResult({
    result: `${formatBlameTable(lines)}\n\nWhy:\n${formatExplanations(entries)}${notice}`,
    mode: 'stdout',
  })

  if (agentError) {
    commandExit(1)
  }
}
