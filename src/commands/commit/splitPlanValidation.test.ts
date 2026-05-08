import { FileChange } from '../../lib/types'
import {
  formatPlanValidationFeedback,
  formatPlanValidationIssuesError,
  getPlanValidationIssues,
  hasPlanValidationIssues,
  HunkInventoryLike,
} from './splitPlanValidation'
import { CommitSplitPlan } from './splitPlanTypes'

const stagedFile = (filePath: string): FileChange => ({
  filePath,
  status: 'modified',
  summary: '',
})

const buildHunkInventory = (
  byFile: Record<string, string[]>
): HunkInventoryLike => {
  const byIdMap = new Map<string, { id: string; filePath: string }>()
  const byFileMap = new Map<string, { id: string; filePath: string }[]>()

  for (const [filePath, hunkIds] of Object.entries(byFile)) {
    const hunks = hunkIds.map((id) => ({ id, filePath }))
    byFileMap.set(filePath, hunks)
    for (const hunk of hunks) {
      byIdMap.set(hunk.id, hunk)
    }
  }

  return { byId: byIdMap, byFile: byFileMap }
}

describe('splitPlanValidation', () => {
  describe('getPlanValidationIssues', () => {
    it('returns no issues for a clean file-level plan', () => {
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'a', files: ['a.ts'], hunks: [] },
          { title: 'b', files: ['b.ts'], hunks: [] },
        ],
      }

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts'), stagedFile('b.ts')])

      expect(hasPlanValidationIssues(issues)).toBe(false)
    })

    it('flags files not in the staged inventory as unknown', () => {
      const plan: CommitSplitPlan = {
        groups: [{ title: 'a', files: ['a.ts', 'ghost.ts'], hunks: [] }],
      }

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')])

      expect(issues.unknownFiles).toEqual(['ghost.ts'])
    })

    it('flags duplicate file assignments across groups', () => {
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'a', files: ['a.ts'], hunks: [] },
          { title: 'a-again', files: ['a.ts'], hunks: [] },
        ],
      }

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')])

      expect(issues.duplicateFiles).toEqual(['a.ts'])
    })

    it('flags missing staged files that never appear in any group', () => {
      const plan: CommitSplitPlan = {
        groups: [{ title: 'a', files: ['a.ts'], hunks: [] }],
      }

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts'), stagedFile('b.ts')])

      expect(issues.missingFiles).toEqual(['b.ts'])
    })

    it('flags unknown hunk IDs', () => {
      const plan: CommitSplitPlan = {
        groups: [{ title: 'a', files: [], hunks: ['a.ts::hunk-99'] }],
      }
      const inventory = buildHunkInventory({ 'a.ts': ['a.ts::hunk-1', 'a.ts::hunk-2'] })

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')], inventory)

      expect(issues.unknownHunks).toEqual(['a.ts::hunk-99'])
    })

    it('flags duplicate hunk IDs across groups', () => {
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'a', files: [], hunks: ['a.ts::hunk-1'] },
          { title: 'a-again', files: [], hunks: ['a.ts::hunk-1'] },
        ],
      }
      const inventory = buildHunkInventory({ 'a.ts': ['a.ts::hunk-1', 'a.ts::hunk-2'] })

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')], inventory)

      expect(issues.duplicateHunks).toEqual(['a.ts::hunk-1'])
    })

    it('flags files assigned both as whole files and via hunks', () => {
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'whole', files: ['a.ts'], hunks: [] },
          { title: 'hunked', files: [], hunks: ['a.ts::hunk-1'] },
        ],
      }
      const inventory = buildHunkInventory({ 'a.ts': ['a.ts::hunk-1'] })

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')], inventory)

      expect(issues.mixedFiles).toEqual(['a.ts'])
    })

    it('flags files with only some hunks assigned', () => {
      const plan: CommitSplitPlan = {
        groups: [{ title: 'a', files: [], hunks: ['a.ts::hunk-1'] }],
      }
      const inventory = buildHunkInventory({ 'a.ts': ['a.ts::hunk-1', 'a.ts::hunk-2'] })

      const issues = getPlanValidationIssues(plan, [stagedFile('a.ts')], inventory)

      expect(issues.partiallyCoveredFiles).toEqual(['a.ts'])
    })
  })

  describe('formatPlanValidationFeedback', () => {
    it('returns an empty string when there are no issues', () => {
      const feedback = formatPlanValidationFeedback({
        unknownFiles: [],
        duplicateFiles: [],
        unknownHunks: [],
        duplicateHunks: [],
        mixedFiles: [],
        partiallyCoveredFiles: [],
        missingFiles: [],
      })

      expect(feedback).toBe('')
    })

    it('formats each issue category as a bullet line with file lists', () => {
      const feedback = formatPlanValidationFeedback({
        unknownFiles: ['ghost.ts'],
        duplicateFiles: ['a.ts'],
        unknownHunks: ['x::hunk-9'],
        duplicateHunks: ['a.ts::hunk-1'],
        mixedFiles: ['b.ts'],
        partiallyCoveredFiles: ['c.ts'],
        missingFiles: ['d.ts'],
      })

      expect(feedback).toContain('- Files referenced that are NOT in the staged file inventory')
      expect(feedback).toContain('ghost.ts')
      expect(feedback).toContain('Files assigned to more than one group')
      expect(feedback).toContain('a.ts')
      expect(feedback).toContain('Hunk IDs referenced that are NOT in the staged hunk inventory')
      expect(feedback).toContain('x::hunk-9')
      expect(feedback).toContain('Files assigned BOTH as whole files and via hunks')
      expect(feedback).toContain('b.ts')
      expect(feedback).toContain('Files with only some hunks assigned')
      expect(feedback).toContain('c.ts')
      expect(feedback).toContain('Staged files missing from every group')
      expect(feedback).toContain('d.ts')
    })
  })

  describe('formatPlanValidationIssuesError', () => {
    it('joins issue categories with semicolons', () => {
      const message = formatPlanValidationIssuesError({
        unknownFiles: ['ghost.ts'],
        duplicateFiles: ['a.ts'],
        unknownHunks: [],
        duplicateHunks: [],
        mixedFiles: [],
        partiallyCoveredFiles: [],
        missingFiles: [],
      })

      expect(message).toBe('unknown files: ghost.ts; duplicate files: a.ts')
    })
  })
})
