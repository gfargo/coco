import { PromptTemplate } from '@langchain/core/prompts'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { Logger } from '../../lib/utils/logger'
import { TokenCounter } from '../../lib/utils/tokenizer'
import { FileChange } from '../../lib/types'
import { CommitSplitPlan, CommitSplitPlanSchema } from './splitPlanTypes'
import {
  formatPlanValidationFeedback,
  formatPlanValidationIssuesError,
  getPlanValidationIssues,
  hasPlanValidationIssues,
  HunkInventoryLike,
  PlanValidationIssues,
  rescuePhantomHunks,
} from './splitPlanValidation'

export const NO_PREVIOUS_FEEDBACK_PLACEHOLDER = 'None — this is the first attempt.'

export const DEFAULT_MAX_PLAN_ATTEMPTS = 3

export interface GenerateSplitPlanArgs {
  llm: ReturnType<typeof getLlm>
  prompt: PromptTemplate
  variables: Record<string, unknown>
  staged: FileChange[]
  hunkInventory?: HunkInventoryLike
  logger?: Logger
  tokenizer?: TokenCounter
  metadata?: Record<string, unknown>
  /** Total attempts including the initial call. Defaults to 3. */
  maxAttempts?: number
}

export interface GenerateSplitPlanResult {
  plan: CommitSplitPlan
  attempts: number
}

/**
 * Generate a commit-split plan with self-correcting retries on validator failures.
 *
 * The first attempt runs as normal. If `validatePlanForStagedFiles` rejects the result,
 * the validator's complaints are formatted as natural-language feedback and fed back
 * into the same prompt template (`previous_attempt_feedback` slot) so the model can
 * fix its own mistakes without re-running pre-processing.
 */
export async function generateValidatedCommitSplitPlan({
  llm,
  prompt,
  variables,
  staged,
  hunkInventory,
  logger,
  tokenizer,
  metadata = {},
  maxAttempts = DEFAULT_MAX_PLAN_ATTEMPTS,
}: GenerateSplitPlanArgs): Promise<GenerateSplitPlanResult> {
  let lastIssues: PlanValidationIssues | null = null
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt++

    const previousFeedback = lastIssues
      ? formatPlanValidationFeedback(lastIssues)
      : NO_PREVIOUS_FEEDBACK_PLACEHOLDER

    const rawPlan = await executeChainWithSchema<CommitSplitPlan>(
      CommitSplitPlanSchema,
      llm,
      prompt,
      {
        ...variables,
        previous_attempt_feedback: previousFeedback,
      },
      {
        logger,
        tokenizer,
        metadata: {
          task: 'commit-split-plan',
          ...metadata,
          planAttempt: attempt,
        },
      }
    )

    // Rescue pass: when the staged set is all new/added files (no
    // hunk inventory), the LLM commonly emits "file::hunk-1" entries
    // anyway because the prompt's hunk-aware language convinces it
    // that's the right format. The validator then rejects them as
    // unknown hunks and the retry loop just regenerates the same
    // mistake. Pre-validation, promote phantom hunks back to
    // file-level assignments — same semantic, accepted by the
    // validator, no LLM re-roll needed.
    const plan = rescuePhantomHunks(rawPlan, staged, hunkInventory)

    const issues = getPlanValidationIssues(plan, staged, hunkInventory)
    if (!hasPlanValidationIssues(issues)) {
      if (attempt > 1 && logger) {
        logger.verbose(`Plan validated after ${attempt} attempts.`, { color: 'green' })
      }
      return { plan, attempts: attempt }
    }

    lastIssues = issues

    if (logger) {
      logger.verbose(
        `Plan attempt ${attempt}/${maxAttempts} failed validation: ${formatPlanValidationIssuesError(
          issues
        )}`,
        { color: 'yellow' }
      )
    }
  }

  throw new Error(
    lastIssues
      ? `Failed to produce a valid commit-split plan after ${maxAttempts} attempts. Final validator issues: ${formatPlanValidationIssuesError(
          lastIssues
        )}`
      : `Failed to produce a valid commit-split plan after ${maxAttempts} attempts.`
  )
}
