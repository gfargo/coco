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
