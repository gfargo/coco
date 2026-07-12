import { buildStatusSurfaceData } from './buildStatusSurfaceData'
import type { WorktreeFile, WorktreeFileVisibilityMask } from '../../../git/statusData'

/**
 * Unit tests for the pure `buildStatusSurfaceData` core (0.72 app.ts
 * decomposition). No React harness — the hook (`useStatusSurfaceData`) is
 * a thin per-value `useMemo` wrapper, so testing the pure derivation
 * exercises all the status-surface behavior lifted verbatim out of
 * app.ts. Mirrors `buildFilteredLists.test.ts`.
 */

const ALL_VISIBLE: WorktreeFileVisibilityMask = {
  staged: true,
  unstaged: true,
  untracked: true,
}

function file(path: string, state: WorktreeFile['state']): WorktreeFile {
  // indexStatus / worktreeStatus only need to be plausible — the
  // derivations key off `state` (mask + grouping) and `path` (identity).
  const indexStatus = state === 'staged' ? 'M' : state === 'untracked' ? '?' : ' '
  const worktreeStatus = state === 'unstaged' ? 'M' : state === 'untracked' ? '?' : ' '
  return { path, indexStatus, worktreeStatus, state }
}

// Deliberately out of canonical order (untracked before staged) so the
// grouping/flattening reordering is observable.
const files: WorktreeFile[] = [
  file('c.txt', 'untracked'),
  file('a.txt', 'staged'),
  file('b.txt', 'unstaged'),
  file('d.txt', 'staged'),
]

describe('buildStatusSurfaceData', () => {
  describe('the visibility mask narrows the worktree files', () => {
    it('returns every file when the mask is all-on', () => {
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeFiles).toHaveLength(4)
    })

    it('drops files whose state is masked off', () => {
      const result = buildStatusSurfaceData(
        files,
        { staged: true, unstaged: false, untracked: false },
        0,
        undefined,
      )
      expect(result.visibleWorktreeFiles.map((f) => f.path)).toEqual(['a.txt', 'd.txt'])
    })
  })

  describe('grouping + flattening shapes', () => {
    it('emits groups in canonical staged -> unstaged -> untracked order', () => {
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeGroups.map((g) => g.state)).toEqual([
        'staged',
        'unstaged',
        'untracked',
      ])
    })

    it('records each group startIndex against the flattened list', () => {
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeGroups.map((g) => g.startIndex)).toEqual([0, 2, 3])
    })

    it('flattens into canonical order regardless of input order', () => {
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeFilesGrouped.map((f) => f.path)).toEqual([
        'a.txt',
        'd.txt',
        'b.txt',
        'c.txt',
      ])
    })
  })

  describe('selectedWorktreeFile resolves by index into the flattened list', () => {
    it('resolves the file at the canonical index', () => {
      // Flattened order is [a, d, b, c] — index 2 is the unstaged file.
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 2, undefined)
      expect(result.selectedWorktreeFile?.path).toBe('b.txt')
    })

    it('clamps an out-of-range index to the last visible file (#1588)', () => {
      // A refresh (revert / external stage) can shrink the visible list
      // out from under a stale selectedWorktreeFileIndex. Flattened order
      // is [a, d, b, c] (4 files) — index 9 must clamp to c.txt, not
      // resolve to undefined and strand the cursor / file actions.
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 9, undefined)
      expect(result.selectedWorktreeFile?.path).toBe('c.txt')
    })

    it('clamps to index 0 when the visible list is empty', () => {
      const result = buildStatusSurfaceData([], ALL_VISIBLE, 9, undefined)
      expect(result.selectedWorktreeFile).toBeUndefined()
    })

    it('resolves against the *visible* (masked) flattened list, not the raw files', () => {
      // Only staged files visible => flattened [a, d]; index 1 is d.txt.
      const result = buildStatusSurfaceData(
        files,
        { staged: true, unstaged: false, untracked: false },
        1,
        undefined,
      )
      expect(result.selectedWorktreeFile?.path).toBe('d.txt')
    })
  })

  describe('stashDiffParsedFiles segments the active stash patch', () => {
    it('parses per-file sections from the patch lines', () => {
      const lines = [
        'diff --git a/foo.ts b/foo.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/bar.ts b/bar.ts',
        '@@ -1 +1 @@',
        '-x',
        '+y',
      ]
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, lines)
      expect(result.stashDiffParsedFiles.map((f) => f.path)).toEqual(['foo.ts', 'bar.ts'])
      expect(result.stashDiffParsedFiles.map((f) => f.startLine)).toEqual([0, 4])
    })

    it('returns [] when no stash diff is loaded', () => {
      const result = buildStatusSurfaceData(files, ALL_VISIBLE, 0, undefined)
      expect(result.stashDiffParsedFiles).toEqual([])
    })
  })

  describe('empty / undefined inputs yield safe empties', () => {
    it('undefined worktree files => empty derivations', () => {
      const result = buildStatusSurfaceData(undefined, ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeFiles).toEqual([])
      expect(result.visibleWorktreeGroups).toEqual([])
      expect(result.visibleWorktreeFilesGrouped).toEqual([])
      expect(result.selectedWorktreeFile).toBeUndefined()
      expect(result.stashDiffParsedFiles).toEqual([])
    })

    it('empty file list => no groups and no selection', () => {
      const result = buildStatusSurfaceData([], ALL_VISIBLE, 0, undefined)
      expect(result.visibleWorktreeGroups).toEqual([])
      expect(result.selectedWorktreeFile).toBeUndefined()
    })
  })
})
