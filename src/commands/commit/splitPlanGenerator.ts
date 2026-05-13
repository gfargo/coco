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
  rescueMissingFiles,
  rescueMixedFiles,
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

    // Rescue passes (#918, #919, #921). Run in order — order matters:
    //
    //   1. rescuePhantomHunks: LLM commonly emits "file::hunk-1"
    //      against an empty inventory (all staged files are new).
    //      Promote those to file-level assignments.
    //
    //   2. rescueMixedFiles: LLM commonly puts a file in `files[]`
    //      of group A AND uses its hunks in `hunks[]` of group B.
    //      Drop the hunks (the file-level claim is more specific).
    //      Must run AFTER phantom-hunk rescue because the rescue
    //      itself can create mixed-files situations.
    //
    //   3. rescueMissingFiles: LLM occasionally forgets a staged
    //      file across every group. Append a synthetic "misc" group
    //      so the plan covers every staged file. Must run LAST so
    //      it has the final claim picture from earlier rescues.
    //
    // All three rescues are no-ops when there's nothing to rescue,
    // so running them unconditionally costs nothing on healthy plans.
    const phantomRescued = rescuePhantomHunks(rawPlan, staged, hunkInventory)
    const mixedRescued = rescueMixedFiles(phantomRescued, hunkInventory)
    const plan = rescueMissingFiles(mixedRescued, staged, hunkInventory)

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
