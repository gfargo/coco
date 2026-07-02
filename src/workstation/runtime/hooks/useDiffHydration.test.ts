import {
  shouldLoadWorktreeDiff,
  useCommitFilePreviewHydration,
  useCommitFilePreviewState,
  useCompareDiffHydration,
  useCompareDiffState,
  useStashDiffHydration,
  useStashDiffState,
  useWorktreeDiffState,
  useWorktreeHunksState,
} from './useDiffHydration'
import type { WorktreeFile } from '../../../git/statusData'

type EffectFn = () => void | (() => void)

/** Fake React that records the single `useEffect` so the test can run it. */
function effectReact(): {
  React: typeof import('react')
  runEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
  } as unknown as typeof import('react')
  return { React, runEffect: () => effects[0]() }
}

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
  it('loads (true) on the staging diff with a cursored file', () => {
    expect(shouldLoadWorktreeDiff('diff', 'worktree', file('src/app.ts'))).toBe(true)
    // The `g d` chord pushes the diff view without a source tag —
    // undefined still means the staging diff.
    expect(shouldLoadWorktreeDiff('diff', undefined, file('src/app.ts'))).toBe(true)
  })

  // Regression: with a dirty worktree, hydrating worktree hunks under a
  // commit/stash/compare diff let Space/z stage or discard hunks of a
  // file the user was not looking at (and j/k scrolled the invisible
  // worktree offset instead of the visible diff).
  it('skips (false) on commit / stash / compare diffs', () => {
    expect(shouldLoadWorktreeDiff('diff', 'commit', file('src/app.ts'))).toBe(false)
    expect(shouldLoadWorktreeDiff('diff', 'stash', file('src/app.ts'))).toBe(false)
    expect(shouldLoadWorktreeDiff('diff', 'compare', file('src/app.ts'))).toBe(false)
  })

  it('skips (false) when no worktree file is cursored', () => {
    expect(shouldLoadWorktreeDiff('diff', 'worktree', undefined)).toBe(false)
  })

  it('skips (false) when the active view is not the diff view', () => {
    expect(shouldLoadWorktreeDiff('history', 'worktree', file('src/app.ts'))).toBe(false)
    expect(shouldLoadWorktreeDiff('status', undefined, file('src/app.ts'))).toBe(false)
  })

  it('skips (false) when neither condition holds', () => {
    expect(shouldLoadWorktreeDiff('history', undefined, undefined)).toBe(false)
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

/**
 * Loader bail must clear the `*Loading` flag, not just return. If the view /
 * selection changes away while a fetch is in flight, the effect cleanup flips
 * `active` false so the in-flight branch never resets the flag — without the
 * reset on the bail, the surface is left stuck on "Loading…". (No data fetch
 * happens on the bail, so no data-layer mock is needed.)
 */
describe('loader bail clears its loading flag', () => {
  const git = {} as never

  it('stash: guard-fail bail resets setStashDiffLoading(false)', () => {
    const setStashDiffLoading = jest.fn()
    const { React, runEffect } = effectReact()
    useStashDiffHydration(React, {
      git,
      activeView: 'history', // not 'diff' → guard fails
      diffSource: 'stash',
      stashDiffRef: 'stash@{0}',
      setStashDiffLines: jest.fn(),
      setStashDiffLoading,
    })
    runEffect()
    expect(setStashDiffLoading).toHaveBeenCalledWith(false)
  })

  it('compare: guard-fail bail resets setCompareDiffLoading(false)', () => {
    const setCompareDiffLoading = jest.fn()
    const { React, runEffect } = effectReact()
    useCompareDiffHydration(React, {
      git,
      activeView: 'diff',
      diffSource: 'compare',
      compareBaseRef: undefined, // missing ref → guard fails
      compareHeadRef: 'HEAD',
      setCompareDiffLines: jest.fn(),
      setCompareDiffLoading,
    })
    runEffect()
    expect(setCompareDiffLoading).toHaveBeenCalledWith(false)
  })

  it('commit file preview: no-selection bail resets setFilePreviewLoading(false)', () => {
    const setFilePreview = jest.fn()
    const setFilePreviewLoading = jest.fn()
    const { React, runEffect } = effectReact()
    useCommitFilePreviewHydration(React, {
      git,
      selected: undefined, // no commit → bail
      selectedDetailFile: undefined,
      setFilePreview,
      setFilePreviewLoading,
    })
    runEffect()
    expect(setFilePreview).toHaveBeenCalledWith(undefined)
    expect(setFilePreviewLoading).toHaveBeenCalledWith(false)
  })
})
