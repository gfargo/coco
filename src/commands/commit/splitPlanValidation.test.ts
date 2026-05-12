import { FileChange } from '../../lib/types'
import {
  formatPlanValidationFeedback,
  formatPlanValidationIssuesError,
  getPlanValidationIssues,
  hasPlanValidationIssues,
  HunkInventoryLike,
  rescuePhantomHunks,
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

  describe('rescuePhantomHunks', () => {
    // The dominant failure pattern from #916 testing: all staged files
    // are new/added (so collectHunkInventory skips them, leaving an
    // empty inventory), but the LLM still emits hunk IDs in the
    // canonical `<filepath>::hunk-N` shape. Validator rejects them as
    // unknown; retry loop just regenerates the same mistake. Rescue
    // promotes those phantom hunks to file-level assignments so the
    // semantically-equivalent plan survives validation.

    it('rescues phantom hunks to file-level assignments when inventory is empty', () => {
      const staged = ['src/widgets/button.ts', 'src/widgets/input.ts'].map(stagedFile)
      const plan: CommitSplitPlan = {
        groups: [
          {
            title: 'feat: widgets',
            files: [],
            hunks: ['src/widgets/button.ts::hunk-1', 'src/widgets/input.ts::hunk-1'],
          },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, buildHunkInventory({}))

      expect(rescued.groups[0].files).toEqual([
        'src/widgets/button.ts',
        'src/widgets/input.ts',
      ])
      expect(rescued.groups[0].hunks).toEqual([])
    })

    it('preserves real hunk IDs that are in the inventory', () => {
      const staged = ['src/router.ts'].map(stagedFile)
      const inventory = buildHunkInventory({
        'src/router.ts': ['src/router.ts::hunk-1', 'src/router.ts::hunk-2'],
      })
      const plan: CommitSplitPlan = {
        groups: [
          {
            title: 'feat: router',
            files: [],
            hunks: ['src/router.ts::hunk-1', 'src/router.ts::hunk-2'],
          },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, inventory)

      // Real hunks pass through, no file-level promotion.
      expect(rescued.groups[0].hunks).toEqual([
        'src/router.ts::hunk-1',
        'src/router.ts::hunk-2',
      ])
      expect(rescued.groups[0].files).toEqual([])
    })

    it('first group wins when multiple groups reference the same phantom hunk', () => {
      // LLM mistake: split a "single file's hunks" across groups when
      // the file actually has zero hunks. Rescue assigns the file to
      // the first group only; subsequent groups silently drop the
      // phantom hunk.
      const staged = ['src/widget.ts'].map(stagedFile)
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'feat: a', files: [], hunks: ['src/widget.ts::hunk-1'] },
          { title: 'feat: b', files: [], hunks: ['src/widget.ts::hunk-1'] },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, buildHunkInventory({}))

      expect(rescued.groups[0].files).toEqual(['src/widget.ts'])
      expect(rescued.groups[1].files).toEqual([])
      expect(rescued.groups[0].hunks).toEqual([])
      expect(rescued.groups[1].hunks).toEqual([])
    })

    it('does not duplicate-claim a file already in another group\'s files[]', () => {
      // If group A already legitimately claims the file via files[],
      // group B's phantom hunk for that file just drops — no
      // duplicateFiles validator error.
      const staged = ['src/widget.ts'].map(stagedFile)
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'feat: a', files: ['src/widget.ts'], hunks: [] },
          { title: 'feat: b', files: [], hunks: ['src/widget.ts::hunk-1'] },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, buildHunkInventory({}))

      expect(rescued.groups[0].files).toEqual(['src/widget.ts'])
      expect(rescued.groups[1].files).toEqual([])
    })

    it('drops phantom hunks whose file path is not in the staged set', () => {
      // LLM hallucinated both the hunk AND a file that doesn't exist.
      // Drop the hunk; the validator's missingFiles check will catch
      // any actually-missing staged files separately.
      const staged = ['src/real.ts'].map(stagedFile)
      const plan: CommitSplitPlan = {
        groups: [
          {
            title: 'feat: x',
            files: ['src/real.ts'],
            hunks: ['src/hallucinated.ts::hunk-1'],
          },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, buildHunkInventory({}))

      expect(rescued.groups[0].files).toEqual(['src/real.ts'])
      expect(rescued.groups[0].hunks).toEqual([])
    })

    it('handles a mix of real hunks (kept) and phantom hunks (rescued)', () => {
      // Edge case: inventory has hunks for one file (modified) but
      // the LLM also emits a phantom hunk for a different staged
      // file that has no inventory (added). Both should be handled
      // correctly — real preserved, phantom rescued.
      const staged = ['src/router.ts', 'src/widget.ts'].map(stagedFile)
      const inventory = buildHunkInventory({
        'src/router.ts': ['src/router.ts::hunk-1'],
      })
      const plan: CommitSplitPlan = {
        groups: [
          {
            title: 'feat: combined',
            files: [],
            hunks: ['src/router.ts::hunk-1', 'src/widget.ts::hunk-1'],
          },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, inventory)

      expect(rescued.groups[0].hunks).toEqual(['src/router.ts::hunk-1'])
      expect(rescued.groups[0].files).toEqual(['src/widget.ts'])
    })

    it('is a no-op when there are no hunks anywhere', () => {
      const staged = ['src/a.ts', 'src/b.ts'].map(stagedFile)
      const plan: CommitSplitPlan = {
        groups: [
          { title: 'feat: ab', files: ['src/a.ts', 'src/b.ts'], hunks: [] },
        ],
      }

      const rescued = rescuePhantomHunks(plan, staged, buildHunkInventory({}))

      expect(rescued).toEqual(plan)
    })
  })
})
