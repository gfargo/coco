import {
  shouldLoadWorktreeDiff,
  useCommitFilePreviewState,
  useCompareDiffState,
  useStashDiffState,
  useWorktreeDiffState,
  useWorktreeHunksState,
} from './useDiffHydration'
import type { WorktreeFile } from '../../../git/statusData'

/**
 * Fake React whose `useState` runs the lazy initializer (if any) and returns a
 * jest setter, so the state hooks can be exercised without a renderer.
 */
const fakeReact = () =>
  ({
    useState: (init: unknown) => [
      typeof init === 'function' ? (init as () => unknown)() : init,
      jest.fn(),
    ],
  }) as unknown as typeof import('react')

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

/**
 * `useCommitFilePreviewState` (app.ts decomposition item 2 / #1237) owns the
 * commit file-preview `useState` pair. Driven through a minimal fake-React
 * harness — it must seed both slots empty and surface both setters so the
 * loader effect can toggle them.
 */
describe('useCommitFilePreviewState', () => {
  it('seeds filePreview undefined and filePreviewLoading false, exposing both setters', () => {
    const result = useCommitFilePreviewState(fakeReact())

    expect(result.filePreview).toBeUndefined()
    expect(result.filePreviewLoading).toBe(false)
    expect(typeof result.setFilePreview).toBe('function')
    expect(typeof result.setFilePreviewLoading).toBe('function')
  })
})

/**
 * The remaining diff-hydration state hooks (app.ts decomposition #1237) each
 * own one `useState` pair and surface its values + setters. The setters for
 * worktree-diff / worktree-hunks (staging) and compare (compare-reset effect)
 * are shared, so app.ts threads them to multiple consumers — verified here only
 * that each hook seeds empty and exposes both setters.
 */
describe('useStashDiffState', () => {
  it('seeds lines undefined + loading false and exposes both setters', () => {
    const result = useStashDiffState(fakeReact())
    expect(result.stashDiffLines).toBeUndefined()
    expect(result.stashDiffLoading).toBe(false)
    expect(typeof result.setStashDiffLines).toBe('function')
    expect(typeof result.setStashDiffLoading).toBe('function')
  })
})

describe('useCompareDiffState', () => {
  it('seeds lines undefined + loading false and exposes both setters', () => {
    const result = useCompareDiffState(fakeReact())
    expect(result.compareDiffLines).toBeUndefined()
    expect(result.compareDiffLoading).toBe(false)
    expect(typeof result.setCompareDiffLines).toBe('function')
    expect(typeof result.setCompareDiffLoading).toBe('function')
  })
})

describe('useWorktreeHunksState', () => {
  it('seeds hunks undefined + loading false and exposes both setters', () => {
    const result = useWorktreeHunksState(fakeReact())
    expect(result.worktreeHunks).toBeUndefined()
    expect(result.worktreeHunksLoading).toBe(false)
    expect(typeof result.setWorktreeHunks).toBe('function')
    expect(typeof result.setWorktreeHunksLoading).toBe('function')
  })
})

describe('useWorktreeDiffState', () => {
  it('seeds diff undefined + loading false and exposes both setters', () => {
    const result = useWorktreeDiffState(fakeReact())
    expect(result.worktreeDiff).toBeUndefined()
    expect(result.worktreeDiffLoading).toBe(false)
    expect(typeof result.setWorktreeDiff).toBe('function')
    expect(typeof result.setWorktreeDiffLoading).toBe('function')
  })
})
