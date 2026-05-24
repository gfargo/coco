import { Arguments } from 'yargs'
import { type TiktokenModel } from '@langchain/openai'
import { SimpleGit } from 'simple-git'

import { loadConfig } from '../../lib/config/utils/loadConfig'
import {
  getApiKeyForModel,
  getModelAndProviderFromConfig,
} from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { executeChainStreaming } from '../../lib/langchain/utils/executeChainStreaming'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'
import { enforcePromptBudget } from '../../lib/langchain/utils/enforcePromptBudget'
import { formatCommitMessage } from '../../lib/langchain/utils/formatCommitMessage'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { LLMModel } from '../../lib/langchain/types'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { extractTicketIdFromBranchName } from '../../lib/simple-git/extractTicketIdFromBranchName'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getPreviousCommits } from '../../lib/simple-git/getPreviousCommits'
import { Logger } from '../../lib/utils/logger'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import {
  CommitArgv,
  CommitMessageResponseSchema,
  CommitOptions,
  ConventionalCommitMessageResponseSchema,
} from './config'
import { COMMIT_PROMPT, CONVENTIONAL_COMMIT_PROMPT } from './prompt'

export type CommitDraftInput = {
  git: SimpleGit
  argv: Arguments<CommitOptions>
  logger?: Logger
  /**
   * Optional streaming callback (#881 phase 2). When provided AND
   * `config.service.streaming.enabled` is true, the first generation
   * attempt uses `executeChainStreaming` and fires this callback with
   * each text fragment as it arrives. The handler is intended for
   * live-preview rendering only; the final returned draft still goes
   * through the same fallback parser + commitlint validation as the
   * non-streaming path, so output behaviour is unchanged for the
   * caller.
   *
   * When the streaming attempt's accumulated text can't be parsed
   * into a valid commit message even by the fallback parser, the
   * function falls back to the existing non-streaming
   * `executeChainWithSchema` flow (which has its own LLM-level retry).
   * Net effect: streaming adds a UX preview without removing the
   * resilience of the schema-validated path.
   */
  onStreamChunk?: (text: string, accumulated: string) => void
}

export type CommitDraftResult = {
  ok: boolean
  draft: string
  warnings: string[]
  validationErrors: string[]
}

const FORMAT_INSTRUCTIONS_TEMPLATE = (schemaDescription: string): string => (
  `CRITICAL: You must return ONLY a valid JSON object with no additional text, explanations, or markdown formatting.

REQUIRED JSON FORMAT:
${schemaDescription}

EXAMPLE (follow this EXACT format - compact JSON on a single line or minimal whitespace):
{"title": "feat(auth): add user authentication system", "body": "Implement JWT-based authentication with login and logout functionality. Includes password hashing and session management."}

IMPORTANT RULES:
- Return ONLY the JSON object - NO markdown code blocks, NO backticks, NO extra text
- ALL string values MUST be enclosed in double quotes
- Use compact JSON format (minimal whitespace) for best compatibility
- NO trailing commas
- NO comments or additional text outside the JSON
- The "title" and "body" values must be properly quoted strings`
)

/**
 * Generate a commit message draft with no UI side effects.
 *
 * Mirrors the LLM-chain logic from `commit/handler.ts`'s agent callback but
 * skips the review loop, ora spinners, Inquirer prompts, and stdout writes
 * that would corrupt the surrounding Ink TUI alt screen. Validation failures
 * are surfaced as `validationErrors`/`warnings` rather than driving an
 * interactive retry flow — the TUI can re-invoke or let the user edit.
 */
/**
 * Fallback parser shared between the non-streaming
 * `executeChainWithSchema` call and the streaming path (#881 phase 2).
 *
 * Extracted from the inline `fallbackParser` option so the streaming
 * path can use the same lossy-but-permissive recovery for accumulated
 * text. Strips markdown code fences, attempts strict JSON parse, and
 * falls back to "first line is title, rest is body" when JSON parsing
 * fails entirely.
 *
 * Returned shape always satisfies the schema's structural requirements
 * (`title` + `body` strings) but the *content* may be the last-ditch
 * "Auto-generated commit" placeholder. Callers should treat this as a
 * best-effort salvage, not a parse confirmation.
 */
function salvageCommitMessageFromText(text: string): { title: string; body: string } {
  try {
    let cleanText = text.trim()
    const codeBlockMatch = cleanText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (codeBlockMatch && codeBlockMatch[1]) {
      cleanText = codeBlockMatch[1].trim()
    }
    const parsed = JSON.parse(cleanText)
    if (
      parsed && typeof parsed === 'object' &&
      typeof parsed.title === 'string' &&
      typeof parsed.body === 'string' &&
      parsed.title.length > 0
    ) {
      return parsed
    }
  } catch {
    // fall through to line-split salvage
  }
  return {
    title: text.split('\n')[0] || 'Auto-generated commit',
    body: text.split('\n').slice(1).join('\n') || 'Generated commit message',
  }
}

export async function generateCommitDraft({
  git,
  argv,
  logger = new Logger({ silent: true }),
  onStreamChunk,
}: CommitDraftInput): Promise<CommitDraftResult> {
  const config = loadConfig<CommitOptions, CommitArgv>(argv as Arguments<CommitArgv>)
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const commitService = resolveDynamicService(config, 'commit')
  const summaryService = resolveDynamicService(config, 'summarize')
  const model = commitService.model

  if (config.service.authentication.type !== 'None' && !key) {
    return {
      ok: false,
      draft: '',
      warnings: [],
      validationErrors: ['No API key configured for the commit service.'],
    }
  }

  const tokenizer = await getTokenCounter(
    provider === 'openai' ? (model as TiktokenModel) : 'gpt-4o'
  )
  const llm = getLlm(provider, model as LLMModel, { ...config, service: commitService })
  const summaryLlm = getLlm(provider, summaryService.model as LLMModel, {
    ...config,
    service: summaryService,
  })

  const useConventional = Boolean(config.conventionalCommits || argv.conventional)

  const changes = await (async () => {
    if (config.noDiff) {
      const status = await git.status()
      return status.files.map((file) => ({
        filePath: file.path,
        status: (file.index === 'A' || file.index === '?'
          ? 'added'
          : 'modified') as 'added' | 'modified',
        summary: file.path,
      }))
    }
    const result = await getChanges({
      git,
      options: {
        ignoredFiles: config.ignoredFiles || undefined,
        ignoredExtensions: config.ignoredExtensions || undefined,
      },
    })
    return result.staged
  })()

  if (!changes || changes.length === 0) {
    return {
      ok: false,
      draft: '',
      warnings: ['No staged changes detected.'],
      validationErrors: [],
    }
  }

  const summary = config.noDiff
    ? `Staged files:\n${changes.map((c) => `${c.status}: ${c.filePath}`).join('\n')}`
    : await fileChangeParser({
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

  if (!summary || !summary.length) {
    return {
      ok: false,
      draft: '',
      warnings: ['Diff summary was empty after parsing staged changes.'],
      validationErrors: [],
    }
  }

  const schema = useConventional
    ? ConventionalCommitMessageResponseSchema
    : CommitMessageResponseSchema
  const promptTemplate = useConventional ? CONVENTIONAL_COMMIT_PROMPT : COMMIT_PROMPT
  const prompt = getPrompt({
    template: config.prompt || (promptTemplate.template as string),
    variables: promptTemplate.inputVariables,
    fallback: promptTemplate,
  })
  const formatInstructions = FORMAT_INSTRUCTIONS_TEMPLATE(schema.description || '')

  const additionalContext = argv.additional ? `## Additional Context\n${argv.additional}` : ''

  let commitHistory = ''
  const previousCommitsCount = Number(argv.withPreviousCommits || 0)
  if (previousCommitsCount > 0) {
    const commitHistoryData = await getPreviousCommits({ git, count: previousCommitsCount })
    if (commitHistoryData) {
      commitHistory = `## Commit History\n${commitHistoryData}`
    }
  }

  const branchName = await getCurrentBranchName({ git })
  const includeBranchName = argv.includeBranchName !== undefined
    ? argv.includeBranchName
    : config.includeBranchName !== false
  const branchNameContext = includeBranchName ? `Current git branch name: ${branchName}` : ''

  const warnings: string[] = []
  const hasCommitLintConfig = await hasCommitlintConfig()
  let commitlintRulesContext = ''
  let validationEnabled = useConventional || hasCommitLintConfig

  if (validationEnabled) {
    const { getCommitlintRulesContext, checkCommitlintAvailability } = await import(
      '../../lib/utils/commitlintValidator'
    )
    const availability = checkCommitlintAvailability()
    if (!availability.available) {
      warnings.push(
        `Skipping commitlint validation: missing packages (${availability.missingPackages.join(', ')}).`
      )
      validationEnabled = false
    } else {
      commitlintRulesContext = await getCommitlintRulesContext()
    }
  }

  const baseVariables: Record<string, string> = {
    summary,
    format_instructions: formatInstructions,
    additional_context: additionalContext,
    commit_history: commitHistory,
    branch_name_context: branchNameContext,
    commitlint_rules_context: commitlintRulesContext,
  }

  const maxParsingAttempts = config.service.provider === 'ollama' && 'maxParsingAttempts' in config.service
    ? config.service.maxParsingAttempts || 3
    : 3

  let lastValidationErrors: string[] = []
  let validationFeedback = ''
  let lastDraft = ''

  // Two attempts max — one initial generation plus one retry that incorporates
  // commitlint feedback. Beyond that we surface warnings and let the TUI user
  // edit the draft manually rather than driving an interactive prompt loop.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const variables = {
      ...baseVariables,
      additional_context: validationFeedback
        ? `${baseVariables.additional_context}\n\n## Validation Errors from Previous Attempt\nPlease fix the following issues:\n${validationFeedback}`
        : baseVariables.additional_context,
    }

    const budgetedPrompt = await enforcePromptBudget({
      prompt,
      variables,
      tokenizer,
      maxTokens: config.service.tokenLimit || 2048,
    })

    // Streaming path (#881 phase 2). Active when the caller supplied
    // an `onStreamChunk` AND the config opted in. Only the FIRST
    // attempt streams; the commitlint-retry attempt (attempt === 2)
    // and the existing executeChainWithSchema retry loop run
    // non-streaming so we keep the schema-validated retry as the
    // backstop when the streamed text can't be salvaged.
    const streamingEnabled = Boolean(
      onStreamChunk && config.service.streaming?.enabled
    )
    const shouldStreamThisAttempt = streamingEnabled && attempt === 1

    let commitMsg: { title: string; body: string }
    if (shouldStreamThisAttempt && onStreamChunk) {
      // The streaming chain bypasses the schema parser during the
      // stream itself (no streaming-aware JSON parser today) and
      // delivers the raw accumulated text to a no-op `parser.invoke`.
      // We then salvage the structured result via the same lossy
      // recovery the non-streaming fallbackParser uses. If the
      // salvager produces a plausible draft, we use it. Otherwise we
      // fall through to executeChainWithSchema below for a real
      // schema-validated retry — paying for a second LLM call only
      // on the edge case where the streamed output is unsalvageable.
      const streamingParser = createSchemaParser(schema, llm)
      let salvaged: { title: string; body: string } | undefined
      try {
        // `executeChainStreaming` runs the parser on the accumulated
        // text at completion. StructuredOutputParser will throw when
        // the model produced unparseable JSON — we catch that below
        // and salvage manually. The happy-path zod-validated object
        // becomes our commitMsg.
        commitMsg = await executeChainStreaming<{ title: string; body: string }>({
          llm,
          prompt,
          variables: budgetedPrompt.variables,
          parser: streamingParser,
          onChunk: ({ text, accumulated }) => {
            onStreamChunk(text, accumulated)
          },
          logger,
          tokenizer,
          metadata: {
            task: useConventional ? 'commit-message-conventional' : 'commit-message',
            command: 'commit-draft',
            provider,
            model: String(model),
          },
        })
      } catch (streamErr) {
        // Streamed accumulated text didn't parse cleanly. Try the
        // lossy salvager on whatever we have; if that produces a
        // non-placeholder title, accept it. Otherwise fall through
        // to the non-streaming path which can retry with a fresh
        // LLM call.
        logger.verbose(
          `Streaming attempt produced unparseable output: ${
            streamErr instanceof Error ? streamErr.message : String(streamErr)
          }. Falling back to non-streaming.`,
          { color: 'yellow' }
        )
        salvaged = undefined
      }
      // Type-narrow: commitMsg is set inside try{}, but TS doesn't
      // see that across the catch. Re-init through the salvage path
      // if streaming threw.
      if (salvaged) {
        commitMsg = salvaged
      } else if (!(commitMsg!)) {
        // Streaming threw; do the standard non-streaming flow to
        // recover. This is the trade-off documented in the issue —
        // streaming gives us a preview but the validated result still
        // comes from the schema-aware retry path when streaming fails.
        commitMsg = await executeChainWithSchema(schema, llm, prompt, budgetedPrompt.variables, {
          logger,
          tokenizer,
          metadata: {
            task: useConventional ? 'commit-message-conventional' : 'commit-message',
            command: 'commit-draft',
            provider,
            model: String(model),
          },
          retryOptions: { maxAttempts: maxParsingAttempts },
          fallbackParser: salvageCommitMessageFromText,
        })
      }
    } else {
      commitMsg = await executeChainWithSchema(schema, llm, prompt, budgetedPrompt.variables, {
        logger,
        tokenizer,
        metadata: {
          task: useConventional ? 'commit-message-conventional' : 'commit-message',
          command: 'commit-draft',
          provider,
          model: String(model),
        },
        retryOptions: {
          maxAttempts: maxParsingAttempts,
        },
        fallbackParser: salvageCommitMessageFromText,
      })
    }

    const ticketId = extractTicketIdFromBranchName(branchName)
    const fullMessage = formatCommitMessage(commitMsg, {
      append: argv.append as string | undefined,
      ticketId: ticketId || undefined,
      appendTicket: argv.appendTicket as boolean | undefined,
    })
    lastDraft = fullMessage

    if (!validationEnabled) {
      return { ok: true, draft: fullMessage, warnings, validationErrors: [] }
    }

    const { validateCommitMessage } = await import('../../lib/utils/commitlintValidator')
    const validationResult = await validateCommitMessage(fullMessage)

    if (validationResult.missingDependencies && validationResult.missingDependencies.length > 0) {
      warnings.push(
        `Skipping commitlint validation: missing packages (${validationResult.missingDependencies.join(', ')}).`
      )
      return { ok: true, draft: fullMessage, warnings, validationErrors: [] }
    }

    if (validationResult.valid) {
      return { ok: true, draft: fullMessage, warnings, validationErrors: [] }
    }

    lastValidationErrors = validationResult.errors
    validationFeedback = validationResult.errors.map((error) => `- ${error}`).join('\n')
  }

  // Both attempts failed validation — return the latest draft so the user can
  // hand-edit in the compose surface, plus the validator output for context.
  return {
    ok: false,
    draft: lastDraft,
    warnings,
    validationErrors: lastValidationErrors,
  }
}
