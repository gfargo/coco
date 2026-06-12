import { shouldLoadWorktreeDiff } from './useDiffHydration'
import type { WorktreeFile } from '../../../git/statusData'

/**
 * Unit tests for the pure `shouldLoadWorktreeDiff` core (0.72 app.ts
 * decomposition, PR 8). No React harness — the five diff-hydration hooks are
 * verbatim lifts of inline-async effects validated by the green build; only
 * the extracted "load the worktree diff data only when the diff view is
 * active and a file is cursored" guard (shared identically by the
 * worktree-hunks and worktree-file-diff loaders) is exercised here.
 */
const file = (path: string): WorktreeFile =>
  ({ path } as unknown as WorktreeFile)

describe('shouldLoadWorktreeDiff', () => {
  it('loads (true) when the diff view is active and a file is cursored', () => {
    expect(shouldLoadWorktreeDiff('diff', file('src/app.ts'))).toBe(true)
  })

  it('skips (false) when no worktree file is cursored', () => {
    expect(shouldLoadWorktreeDiff('diff', undefined)).toBe(false)
  })

  it('skips (false) when the active view is not the diff view', () => {
    expect(shouldLoadWorktreeDiff('history', file('src/app.ts'))).toBe(false)
    expect(shouldLoadWorktreeDiff('status', file('src/app.ts'))).toBe(false)
  })

  it('skips (false) when neither condition holds', () => {
    expect(shouldLoadWorktreeDiff('history', undefined)).toBe(false)
  })
})
