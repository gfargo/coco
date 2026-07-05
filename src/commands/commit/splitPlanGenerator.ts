import { PromptTemplate } from '@langchain/core/prompts'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { Logger } from '../../lib/utils/logger'
import { TokenCounter } from '../../lib/utils/tokenizer'
import { FileChange } from '../../lib/types'
import { CommitSplitPlan, CommitSplitPlanSchema } from './splitPlanTypes'
import {
  buildSplitPlanFallback,
  detectDuplicateFileNotes,
  detectDuplicateHunkNotes,
  DuplicateRescueNote,
  dropEmptyGroups,
  formatPlanValidationFeedback,
  formatPlanValidationIssuesError,
  getPlanValidationIssues,
  hasPlanValidationIssues,
  HunkInventoryLike,
  PlanValidationIssues,
  rescueDuplicateFiles,
  rescueDuplicateHunks,
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
  /**
   * When true, throw on exhaustion of `maxAttempts` instead of
   * returning the single-group fallback plan. Restores the
   * pre-#1005 behaviour for callers (or CLI users via
   * `--strict-split`) who'd rather see an explicit failure than a
   * degraded plan.
   */
  strict?: boolean
  /**
   * Optional user-cancellation signal — forwarded into each plan
   * attempt's LLM call so Esc in the workstation actually tears the
   * request down (surfaces as `LangChainCancelledError`).
   */
  signal?: AbortSignal
}

/**
 * Metadata describing a degraded plan that was synthesised after the
 * LLM exhausted its attempt budget without producing a valid plan.
 * Absent on the happy path.
 */
export interface SplitPlanFallbackInfo {
  /**
   * Human-readable explanation suitable for status-line surfaces.
   * Includes the count of attempts and the most-recent validator
   * complaints so the user can see WHY they got a fallback.
   */
  reason: string
  /** The validator issues from the final failed attempt, kept verbatim. */
  lastIssues: PlanValidationIssues
}

export interface GenerateSplitPlanResult {
  plan: CommitSplitPlan
  attempts: number
  /**
   * When set, the returned `plan` is a synthesized single-group
   * fallback rather than LLM output. Callers should surface this
   * in their apply / preview UI so the user knows to verify the
   * combined commit message (or re-roll the planner).
   */
  fallback?: SplitPlanFallbackInfo
  /**
   * Set when `rescueDuplicateFiles`/`rescueDuplicateHunks` silently
   * dropped a file/hunk placement the model had ALSO put in an
   * earlier group (#1462 — the model considered more than one "home"
   * for it, the rescue picked the first one, and the plan still
   * passed validation). Absent when the winning attempt had no
   * duplicate placements to rescue. Only reflects the WINNING
   * attempt — a duplicate on an earlier, re-rolled attempt doesn't
   * carry over.
   */
  dedupeWarnings?: DuplicateRescueNote[]
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
  strict = false,
  signal,
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
        signal,
        metadata: {
          task: 'commit-split-plan',
          ...metadata,
          planAttempt: attempt,
        },
      }
    )

    // Rescue passes. Run in order — order matters:
    //
    //   1. rescueDuplicateFiles / rescueDuplicateHunks: weak models
    //      (e.g. gpt-4.1-nano) repeatedly re-assert the same file or
    //      hunk across multiple groups. Keep the first occurrence,
    //      drop the rest. Run FIRST so downstream rescues see a
    //      deduplicated plan and don't re-process redundant entries.
    //
    //   2. rescuePhantomHunks (#918): LLM commonly emits "file::hunk-1"
    //      against an empty inventory (all staged files are new).
    //      Promote those to file-level assignments.
    //
    //   3. rescueMixedFiles (#919): LLM commonly puts a file in
    //      `files[]` of group A AND uses its hunks in `hunks[]` of
    //      group B. Drop the hunks (the file-level claim is more
    //      specific). Must run AFTER phantom-hunk rescue because the
    //      rescue itself can create mixed-files situations.
    //
    //   4. rescueMissingFiles (#921): LLM occasionally forgets a
    //      staged file across every group. Append a synthetic "misc"
    //      group so the plan covers every staged file.
    //
    //   5. dropEmptyGroups: earlier rescues can leave a group with
    //      empty files[] AND empty hunks[] when their only contents
    //      got dropped. Apply-time, an empty group means `git commit`
    //      with nothing staged, which throws and aborts mid-loop
    //      after the up-front `git reset` has already wiped the
    //      index. Filter the empty groups out LAST so the apply path
    //      can't hit them.
    //
    // All rescues are no-ops when there's nothing to rescue, so
    // running them unconditionally costs nothing on healthy plans.
    const dedupeNotes = [
      ...detectDuplicateFileNotes(rawPlan),
      ...detectDuplicateHunkNotes(rawPlan),
    ]
    const dedupedFiles = rescueDuplicateFiles(rawPlan)
    const dedupedHunks = rescueDuplicateHunks(dedupedFiles)
    const phantomRescued = rescuePhantomHunks(dedupedHunks, staged, hunkInventory)
    const mixedRescued = rescueMixedFiles(phantomRescued, hunkInventory)
    const missingRescued = rescueMissingFiles(mixedRescued, staged, hunkInventory)
    const plan = dropEmptyGroups(missingRescued)

    const issues = getPlanValidationIssues(plan, staged, hunkInventory)
    if (!hasPlanValidationIssues(issues)) {
      if (attempt > 1 && logger) {
        logger.verbose(`Plan validated after ${attempt} attempts.`, { color: 'green' })
      }
      return {
        plan,
        attempts: attempt,
        dedupeWarnings: dedupeNotes.length ? dedupeNotes : undefined,
      }
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

  const issuesSummary = lastIssues
    ? formatPlanValidationIssuesError(lastIssues)
    : 'no captured validator issues'

  // Strict mode: restore the pre-#1005 behaviour. Callers that pass
  // `strict: true` (and CLI users via `--strict-split`) want explicit
  // failure rather than the degraded fallback.
  if (strict) {
    throw new Error(
      lastIssues
        ? `Failed to produce a valid commit-split plan after ${maxAttempts} attempts. Final validator issues: ${issuesSummary}`
        : `Failed to produce a valid commit-split plan after ${maxAttempts} attempts.`
    )
  }

  // Default: hand back a trivially-valid single-group fallback. The
  // caller's apply / preview surface should treat the `fallback` flag
  // as a signal to nudge the user (it's strictly better than a hard
  // failure with the staged set still on disk, but it's still a
  // degraded outcome compared to a real multi-group split).
  const reason = `LLM exhausted ${maxAttempts} planning attempts; final validator issues: ${issuesSummary}`
  if (logger) {
    logger.verbose(
      `Plan attempts exhausted — falling back to a single-group plan. ${reason}`,
      { color: 'yellow' }
    )
  }

  return {
    plan: buildSplitPlanFallback(staged, { reason: issuesSummary }),
    attempts: maxAttempts,
    fallback: {
      reason,
      lastIssues: lastIssues ?? {
        unknownFiles: [],
        duplicateFiles: [],
        unknownHunks: [],
        duplicateHunks: [],
        mixedFiles: [],
        partiallyCoveredFiles: [],
        missingFiles: [],
      },
    },
  }
}
