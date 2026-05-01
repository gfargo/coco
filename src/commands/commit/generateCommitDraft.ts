import { Arguments } from 'yargs'
import { type TiktokenModel } from '@langchain/openai'
import { SimpleGit } from 'simple-git'

import { loadConfig } from '../../lib/config/utils/loadConfig'
import {
  getApiKeyForModel,
  getModelAndProviderFromConfig,
} from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
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
export async function generateCommitDraft({
  git,
  argv,
  logger = new Logger({ silent: true }),
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

    const commitMsg = await executeChainWithSchema(schema, llm, prompt, budgetedPrompt.variables, {
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
      fallbackParser: (text: string) => {
        try {
          let cleanText = text.trim()
          const codeBlockMatch = cleanText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
          if (codeBlockMatch && codeBlockMatch[1]) {
            cleanText = codeBlockMatch[1].trim()
          }
          const parsed = JSON.parse(cleanText)
          if (parsed && typeof parsed === 'object' &&
              typeof parsed.title === 'string' &&
              typeof parsed.body === 'string' &&
              parsed.title.length > 0) {
            return parsed
          }
        } catch {
          // fall through
        }
        return {
          title: text.split('\n')[0] || 'Auto-generated commit',
          body: text.split('\n').slice(1).join('\n') || 'Generated commit message',
        }
      },
    })

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
