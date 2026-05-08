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
