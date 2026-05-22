import { FileChange } from '../../lib/types'
import type { CommitSplitGroup, CommitSplitPlan } from './splitPlanTypes'

export type StagedHunkLike = {
  id: string
  filePath: string
}

export type HunkInventoryLike = {
  byId: Map<string, StagedHunkLike>
  byFile: Map<string, StagedHunkLike[]>
}

export interface PlanValidationIssues {
  unknownFiles: string[]
  duplicateFiles: string[]
  unknownHunks: string[]
  duplicateHunks: string[]
  mixedFiles: string[]
  partiallyCoveredFiles: string[]
  missingFiles: string[]
}

const getGroupFiles = (group: CommitSplitGroup): string[] => group.files || []
const getGroupHunks = (group: CommitSplitGroup): string[] => group.hunks || []

export function getPlanValidationIssues(
  plan: CommitSplitPlan,
  staged: FileChange[],
  hunkInventory?: HunkInventoryLike
): PlanValidationIssues {
  const stagedFiles = new Set(staged.map((change) => change.filePath))
  const seen = new Set<string>()
  const seenHunks = new Set<string>()
  const unknownFiles: string[] = []
  const duplicateFiles: string[] = []
  const unknownHunks: string[] = []
  const duplicateHunks: string[] = []

  plan.groups.forEach((group) => {
    getGroupFiles(group).forEach((file) => {
      if (!stagedFiles.has(file)) {
        unknownFiles.push(file)
        return
      }

      if (seen.has(file)) {
        duplicateFiles.push(file)
        return
      }

      seen.add(file)
    })

    getGroupHunks(group).forEach((hunkId) => {
      const hunk = hunkInventory?.byId.get(hunkId)
      if (!hunk) {
        unknownHunks.push(hunkId)
        return
      }

      if (seenHunks.has(hunkId)) {
        duplicateHunks.push(hunkId)
        return
      }

      seenHunks.add(hunkId)
    })
  })

  const hunkCoveredFiles = new Set(
    [...seenHunks].map((hunkId) => hunkInventory?.byId.get(hunkId)?.filePath)
  )
  const mixedFiles = [...seen].filter((file) => hunkCoveredFiles.has(file))
  const partiallyCoveredFiles = [...hunkCoveredFiles]
    .filter((file): file is string => Boolean(file))
    .filter((file) => {
      const fileHunks = hunkInventory?.byFile.get(file) || []
      return fileHunks.some((hunk) => !seenHunks.has(hunk.id))
    })
  const missingFiles = [...stagedFiles].filter(
    (file) => !seen.has(file) && !hunkCoveredFiles.has(file)
  )

  return {
    unknownFiles,
    duplicateFiles,
    unknownHunks,
    duplicateHunks,
    mixedFiles,
    partiallyCoveredFiles,
    missingFiles,
  }
}

export function hasPlanValidationIssues(issues: PlanValidationIssues): boolean {
  return (
    issues.unknownFiles.length > 0 ||
    issues.duplicateFiles.length > 0 ||
    issues.unknownHunks.length > 0 ||
    issues.duplicateHunks.length > 0 ||
    issues.mixedFiles.length > 0 ||
    issues.partiallyCoveredFiles.length > 0 ||
    issues.missingFiles.length > 0
  )
}

export function formatPlanValidationIssuesError(issues: PlanValidationIssues): string {
  return [
    issues.unknownFiles.length ? `unknown files: ${issues.unknownFiles.join(', ')}` : undefined,
    issues.duplicateFiles.length
      ? `duplicate files: ${issues.duplicateFiles.join(', ')}`
      : undefined,
    issues.unknownHunks.length ? `unknown hunks: ${issues.unknownHunks.join(', ')}` : undefined,
    issues.duplicateHunks.length
      ? `duplicate hunks: ${issues.duplicateHunks.join(', ')}`
      : undefined,
    issues.mixedFiles.length
      ? `files assigned both as whole files and hunks: ${issues.mixedFiles.join(', ')}`
      : undefined,
    issues.partiallyCoveredFiles.length
      ? `files with only some hunks assigned: ${issues.partiallyCoveredFiles.join(', ')}`
      : undefined,
    issues.missingFiles.length ? `missing files: ${issues.missingFiles.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * Salvage a plan that lists the same file in `files[]` of more than
 * one group. Weaker models (e.g. `gpt-4.1-nano`) hit this often when
 * the staged set has many files — they re-assert files across groups
 * even though the prompt forbids it.
 *
 * Recovery: walk groups in plan order, keep the FIRST occurrence of
 * each file path, drop subsequent occurrences. Plan-order is used
 * because the LLM tends to put the most thematically-correct
 * assignment in the first group it considered the file for; later
 * appearances are usually accidental re-emissions.
 *
 * If dropping a duplicate leaves a group with empty `files[]` AND
 * empty `hunks[]`, `dropEmptyGroups` (run last) filters it out so
 * the apply path never sees a group with nothing to commit.
 *
 * Returns a NEW plan object — original is not mutated.
 */
export function rescueDuplicateFiles(plan: CommitSplitPlan): CommitSplitPlan {
  const seen = new Set<string>()
  let mutated = false

  const rescuedGroups = plan.groups.map((group) => {
    const keptFiles: string[] = []
    for (const file of group.files || []) {
      if (seen.has(file)) {
        mutated = true
        continue
      }
      seen.add(file)
      keptFiles.push(file)
    }
    return { ...group, files: keptFiles }
  })

  if (!mutated) return plan
  return { ...plan, groups: rescuedGroups }
}

/**
 * Salvage a plan that lists the same hunk ID in `hunks[]` of more
 * than one group. Same failure mode as duplicate files but for the
 * hunk-level assignments.
 *
 * Recovery: keep the FIRST occurrence of each hunk ID across groups
 * (plan order), drop subsequent ones. `dropEmptyGroups` handles any
 * group left fully empty.
 *
 * Returns a NEW plan object — original is not mutated.
 */
export function rescueDuplicateHunks(plan: CommitSplitPlan): CommitSplitPlan {
  const seen = new Set<string>()
  let mutated = false

  const rescuedGroups = plan.groups.map((group) => {
    const keptHunks: string[] = []
    for (const hunkId of group.hunks || []) {
      if (seen.has(hunkId)) {
        mutated = true
        continue
      }
      seen.add(hunkId)
      keptHunks.push(hunkId)
    }
    return { ...group, hunks: keptHunks }
  })

  if (!mutated) return plan
  return { ...plan, groups: rescuedGroups }
}

/**
 * Salvage a plan that references hunk IDs not in the inventory by
 * promoting those hunks to file-level assignments. The LLM commonly
 * does this when the staged set is all new/added files (no
 * inventory) but the prompt's hunk-aware language convinces it to
 * emit "file::hunk-1" anyway.
 *
 * Recovery rules:
 *   1. For each group, walk `hunks[]`. Any entry whose ID isn't in
 *      `inventory.byId` is a phantom — extract the file path from
 *      the `<filepath>::hunk-N` format and drop the hunk.
 *   2. If the recovered file path is in the staged set AND no other
 *      group already claims it via `files[]`, append it to THIS
 *      group's `files[]`. (Across multiple groups referencing the
 *      same phantom hunk, the first group wins — subsequent groups
 *      just drop the hunk without duplicating the file claim.)
 *   3. Real hunk IDs (those in `inventory.byId`) pass through
 *      untouched. Files already in `files[]` pass through untouched.
 *
 * If the inventory has real hunks AND the LLM produces an invalid
 * one (typo, made-up name), the validator still rejects it. This
 * function only rescues the "phantom hunks against an empty
 * inventory" failure mode, which is the dominant failure for
 * scenarios like `dirty-many-files` where every staged file is new.
 *
 * Returns a NEW plan object — original is not mutated.
 */
export function rescuePhantomHunks(
  plan: CommitSplitPlan,
  staged: FileChange[],
  hunkInventory?: HunkInventoryLike
): CommitSplitPlan {
  const stagedFiles = new Set(staged.map((change) => change.filePath))
  const claimedFiles = new Set<string>()
  // First pass: harvest files already claimed via `files[]` so the
  // recovery pass below doesn't double-claim them.
  plan.groups.forEach((group) => {
    (group.files || []).forEach((file) => claimedFiles.add(file))
  })

  const rescuedGroups = plan.groups.map((group) => {
    const rescuedFiles = [...(group.files || [])]
    const keptHunks: string[] = []

    for (const hunkId of group.hunks || []) {
      if (hunkInventory?.byId.has(hunkId)) {
        // Real hunk — pass through.
        keptHunks.push(hunkId)
        continue
      }
      // Phantom hunk. Try to recover the file path.
      const filePath = hunkId.split('::')[0]
      if (filePath && stagedFiles.has(filePath) && !claimedFiles.has(filePath)) {
        rescuedFiles.push(filePath)
        claimedFiles.add(filePath)
      }
      // Either way the phantom hunk gets dropped — if we can't
      // recover the file, the missingFiles validator will catch it
      // and surface a real error. We just don't want "unknown hunks"
      // to be that error when "file-level recovery would have worked".
    }

    return {
      ...group,
      files: rescuedFiles,
      hunks: keptHunks,
    }
  })

  return { ...plan, groups: rescuedGroups }
}

/**
 * Salvage a plan where a file appears BOTH in some group's `files[]`
 * AND as covered by hunks in some (possibly different) group's
 * `hunks[]`. The validator calls this `mixedFiles` and rejects it.
 *
 * Common cause after `rescuePhantomHunks` runs: the LLM put one of
 * the (legitimately modifiable) files in `files[]` of group A, and
 * put its real hunks in `hunks[]` of group B. The phantom-hunk
 * rescue doesn't touch this — real hunks pass through — so the
 * mixed-files combination survives into validation.
 *
 * Recovery: drop the hunks. The `files[]` claim is more specific
 * about user intent ("this whole file goes in commit A"); the hunks
 * become redundant once the whole file is already committed
 * somewhere. The validator's coverage check is satisfied because the
 * file is now claimed exactly once (via `files[]`).
 *
 * If a file's hunks are dropped AND the file isn't in any group's
 * `files[]`, it'll fall through to the `missingFiles` check — but
 * that's caught upstream by the file-coverage requirement.
 *
 * Returns a NEW plan object — original is not mutated.
 */
export function rescueMixedFiles(
  plan: CommitSplitPlan,
  hunkInventory?: HunkInventoryLike
): CommitSplitPlan {
  // First pass: collect every file claimed via files[] across all
  // groups. These are the files whose `hunks[]` entries become
  // redundant.
  const fileClaims = new Set<string>()
  plan.groups.forEach((group) => {
    (group.files || []).forEach((file) => fileClaims.add(file))
  })

  // Second pass: drop hunks whose file path is in fileClaims.
  const rescuedGroups = plan.groups.map((group) => {
    const keptHunks = (group.hunks || []).filter((hunkId) => {
      const hunk = hunkInventory?.byId.get(hunkId)
      // Hunk isn't in inventory → not our problem here (the phantom-
      // hunk rescue handles unknown hunks). Pass through.
      if (!hunk) return true
      // Hunk's file is claimed via files[] somewhere → redundant.
      return !fileClaims.has(hunk.filePath)
    })

    return { ...group, hunks: keptHunks }
  })

  return { ...plan, groups: rescuedGroups }
}

/**
 * Salvage a plan where one or more staged files aren't claimed by any
 * group at all. The validator calls this `missingFiles` and rejects.
 *
 * Recovery: append a synthetic "misc" group containing every missing
 * file. The user can re-roll (`r`) if the model's grouping forgot a
 * critical file they wanted in a specific commit, but a salvageable
 * plan that surfaces ALL staged work is strictly better than
 * exhausting 3 retry attempts and ending in the failure modal.
 *
 * Why append (not distribute across existing groups): each existing
 * group has a thematic identity (title + body + rationale). Quietly
 * inserting a forgotten file into one of them would muddy that
 * theme. A separate "misc" group is honest about what happened ("the
 * model didn't have an obvious home for these — review before
 * applying") and the user can always edit / reject the plan.
 *
 * Run AFTER `rescuePhantomHunks` and `rescueMixedFiles` so any
 * partial recovery from those passes is reflected in the
 * "what's already claimed" calculation.
 *
 * Returns a NEW plan object — original is not mutated. No-op when
 * every staged file is already claimed somewhere.
 */
export function rescueMissingFiles(
  plan: CommitSplitPlan,
  staged: FileChange[],
  hunkInventory?: HunkInventoryLike
): CommitSplitPlan {
  const stagedFiles = new Set(staged.map((change) => change.filePath))
  const claimed = new Set<string>()

  // A file is claimed if it appears in any group's files[] OR if any
  // of its hunks appear in any group's hunks[] (mirrors the validator's
  // missingFiles check).
  plan.groups.forEach((group) => {
    (group.files || []).forEach((file) => claimed.add(file))
    ;(group.hunks || []).forEach((hunkId) => {
      const hunk = hunkInventory?.byId.get(hunkId)
      if (hunk) claimed.add(hunk.filePath)
    })
  })

  const missing = [...stagedFiles].filter((file) => !claimed.has(file))
  if (missing.length === 0) {
    return plan
  }

  // Sort missing files for deterministic output — the LLM's group
  // ordering isn't stable, but our recovery should be.
  missing.sort()

  return {
    ...plan,
    groups: [
      ...plan.groups,
      {
        title: 'chore: misc unclaimed changes',
        body: 'Files the split plan did not assign to any other commit. Review and re-roll (`r`) if these belong in a specific commit.',
        rationale: 'Recovered by validator rescue — model omitted these from every group.',
        files: missing,
        hunks: [],
      },
    ],
  }
}

/**
 * Drop groups that ended up with no claims at all — empty `files[]`
 * AND empty `hunks[]`. These can be produced by the earlier rescue
 * passes:
 *   - `rescueMixedFiles` drops all of a group's hunks when the file
 *     is claimed via `files[]` elsewhere. If the group had ONLY those
 *     hunks (no files of its own), it's left empty.
 *   - LLM output can independently produce empty groups (rare but
 *     observed once the schema's `groups.min(1)` validation passes —
 *     each group only needs the array to exist, not to be non-empty).
 *
 * Apply-time, an empty group means `git add []` (no-op) followed by
 * `git commit` with nothing staged — which throws "nothing to commit"
 * and aborts the entire split-apply mid-loop. The user sees no
 * commits land but their staged set is gone (the up-front
 * `git reset` ran). This filter removes the failure mode entirely.
 *
 * Run LAST in the rescue chain so the filter sees the final state
 * after `rescuePhantomHunks` + `rescueMixedFiles` have done their
 * work and `rescueMissingFiles` has filled in unclaimed files.
 *
 * Returns a NEW plan object. If every group survives, the schema
 * still requires `groups.min(1)` — but if every group dropped, we
 * return an empty groups array and let the validator's coverage
 * check (missingFiles or similar) surface the right error.
 */
export function dropEmptyGroups(plan: CommitSplitPlan): CommitSplitPlan {
  const surviving = plan.groups.filter((group) => {
    const fileCount = (group.files || []).length
    const hunkCount = (group.hunks || []).length
    return fileCount + hunkCount > 0
  })
  if (surviving.length === plan.groups.length) {
    return plan
  }
  return { ...plan, groups: surviving }
}

/**
 * Construct a trivially-valid single-group plan covering every staged
 * file. Used as the fallback when the LLM exhausts its retry budget
 * with an invalid plan — turning a hard failure into a usable
 * (if degraded) outcome.
 *
 * Properties of the returned plan:
 *
 *   - Exactly one group.
 *   - Every staged file appears in that group's `files[]`. No hunks
 *     are claimed, so any hunk inventory is irrelevant to the plan's
 *     validity.
 *   - By construction: no duplicates, no missing files, no mixed
 *     mode, no phantom hunks. `getPlanValidationIssues` returns an
 *     empty issue set.
 *
 * The group's `rationale` carries the reason text the caller wants
 * to expose to the UI (typically "model exhausted N attempts; last
 * issues were …"). The `body` carries a short note that survives
 * into the commit message body so a user who applies without editing
 * has the context recorded in git history.
 *
 * `title` defaults to a generic conventional-commits-compatible
 * `chore: combined commit` — bland on purpose. Real commit messaging
 * is the user's job at the compose / apply step.
 *
 * The plan is NOT linked to the LLM by construction. If the model
 * can't produce a valid split, the user still gets one apply-able
 * commit instead of a thrown error and a still-staged worktree.
 */
export function buildSplitPlanFallback(
  staged: FileChange[],
  options: { reason?: string } = {}
): CommitSplitPlan {
  const files = staged.map((change) => change.filePath)
  const reasonLine = options.reason
    ? ` Reason: ${options.reason}`
    : ''
  return {
    groups: [
      {
        title: 'chore: combined commit',
        body: 'Auto-generated single-commit fallback after the split planner could not produce a valid multi-group plan. Edit before applying if you want a more specific message; press `r` to re-roll the planner if a different model might do better.',
        rationale: `Fallback plan — every staged file in one commit because the LLM could not produce a valid multi-group split.${reasonLine}`,
        files,
        hunks: [],
      },
    ],
  }
}

export function formatPlanValidationFeedback(issues: PlanValidationIssues): string {
  const sections: string[] = []

  if (issues.unknownFiles.length) {
    sections.push(
      `Files referenced that are NOT in the staged file inventory (remove or replace): ${issues.unknownFiles.join(', ')}`
    )
  }

  if (issues.duplicateFiles.length) {
    sections.push(
      `Files assigned to more than one group (each file may appear at most once): ${issues.duplicateFiles.join(', ')}`
    )
  }

  if (issues.unknownHunks.length) {
    sections.push(
      `Hunk IDs referenced that are NOT in the staged hunk inventory: ${issues.unknownHunks.join(', ')}`
    )
  }

  if (issues.duplicateHunks.length) {
    sections.push(
      `Hunk IDs assigned to more than one group (each hunk may appear at most once): ${issues.duplicateHunks.join(', ')}`
    )
  }

  if (issues.mixedFiles.length) {
    sections.push(
      `Files assigned BOTH as whole files and via hunks (pick one mode per file): ${issues.mixedFiles.join(', ')}`
    )
  }

  if (issues.partiallyCoveredFiles.length) {
    sections.push(
      `Files with only some hunks assigned (every hunk for these files must be covered): ${issues.partiallyCoveredFiles.join(', ')}`
    )
  }

  if (issues.missingFiles.length) {
    sections.push(
      `Staged files missing from every group (must appear exactly once): ${issues.missingFiles.join(', ')}`
    )
  }

  return sections.map((section) => `- ${section}`).join('\n')
}
