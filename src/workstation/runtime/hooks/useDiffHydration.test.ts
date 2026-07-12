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
import { getCommitFilePreview, GitCommitFilePreview } from '../../../commands/log/data'
import type { WorktreeFile } from '../../../git/statusData'

jest.mock('../../../commands/log/data', () => ({
  getCommitFilePreview: jest.fn(),
}))

const getCommitFilePreviewMock = getCommitFilePreview as jest.MockedFunction<
  typeof getCommitFilePreview
>

type EffectFn = () => void | (() => void)

/**
 * Fake React that records the single `useEffect` so the test can run it. Also
 * supports `useRef` (needed by `useCommitFilePreviewHydration`'s cache) —
 * each call returns a fresh ref, which is fine for the single-invocation
 * "loader bail" tests below that never re-render the hook.
 */
function effectReact(): {
  React: typeof import('react')
  runEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
    useRef: (init: unknown) => ({ current: init }),
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

/**
 * Debounce + cache behavior for the commit file-preview loader (#OSS-595),
 * mirroring the sibling `useCommitDetailHydration` tests. Unlike the harness
 * above, `useRef` here must persist a single ref *across* separate calls to
 * the hook — simulating React re-invoking the hook body on a re-render while
 * keeping the same ref identity — so a cache populated on one "render" is
 * visible on the next.
 */
describe('useCommitFilePreviewHydration debounce + cache', () => {
  const git = {} as Parameters<typeof useCommitFilePreviewHydration>[1]['git']

  /** Flush pending microtasks so the effect's awaited fetch settles. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  /** Advance fake timers + flush microtasks (for debounced effects). */
  const advanceAndFlush = async (ms: number): Promise<void> => {
    jest.advanceTimersByTime(ms)
    await flush()
  }

  /**
   * Records every `useEffect` call (one per hook invocation, simulating
   * successive renders) and hands back the *latest* one — and returns a
   * single persistent `useRef` across invocations, matching React's real
   * behavior of preserving ref identity across a component's renders.
   */
  function makeReact(): {
    React: typeof import('react')
    runLatestEffect: () => void | (() => void)
  } {
    const effects: EffectFn[] = []
    let ref: { current: unknown } | undefined
    const React = {
      useEffect: (fn: EffectFn) => {
        effects.push(fn)
      },
      useRef: (init: unknown) => {
        if (!ref) ref = { current: init }
        return ref
      },
    } as unknown as typeof import('react')
    return {
      React,
      runLatestEffect: () => effects[effects.length - 1](),
    }
  }

  beforeEach(() => {
    getCommitFilePreviewMock.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('debounces 120ms, then fetches the cursored file and stores the preview', async () => {
    const preview = { hunks: [] } as unknown as GitCommitFilePreview
    getCommitFilePreviewMock.mockResolvedValue(preview)
    const setFilePreview = jest.fn()
    const setFilePreviewLoading = jest.fn()
    const { React, runLatestEffect } = makeReact()

    const selected = { hash: 'abc123' } as never
    const file = { path: 'src/app.ts' } as never

    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: file,
      setFilePreview,
      setFilePreviewLoading,
    })
    runLatestEffect()

    // Loading flips true synchronously (before debounce fires).
    expect(setFilePreviewLoading).toHaveBeenCalledWith(true)
    // But fetch hasn't fired yet (debounce hasn't elapsed).
    expect(getCommitFilePreviewMock).not.toHaveBeenCalled()

    await advanceAndFlush(150)

    expect(getCommitFilePreviewMock).toHaveBeenCalledWith(git, 'abc123', file)
    expect(setFilePreview).toHaveBeenCalledWith(preview)
    expect(setFilePreviewLoading).toHaveBeenLastCalledWith(false)
  })

  it('rapid re-selection resets the debounce timer to a single fetch', async () => {
    const preview = { hunks: [] } as unknown as GitCommitFilePreview
    getCommitFilePreviewMock.mockResolvedValue(preview)
    const setFilePreview = jest.fn()
    const setFilePreviewLoading = jest.fn()
    const { React, runLatestEffect } = makeReact()

    const selected = { hash: 'abc123' } as never
    const fileA = { path: 'a.ts' } as never
    const fileB = { path: 'b.ts' } as never

    // First selection (fileA) starts a debounce timer.
    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: fileA,
      setFilePreview,
      setFilePreviewLoading,
    })
    const cleanupA = runLatestEffect() as () => void

    // Rapid re-selection (fileB) before the 120ms window elapses: cleanup
    // cancels fileA's timer, and only fileB's fetch should ever fire.
    jest.advanceTimersByTime(50)
    cleanupA()
    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: fileB,
      setFilePreview,
      setFilePreviewLoading,
    })
    runLatestEffect()

    await advanceAndFlush(150)

    expect(getCommitFilePreviewMock).toHaveBeenCalledTimes(1)
    expect(getCommitFilePreviewMock).toHaveBeenCalledWith(git, 'abc123', fileB)
  })

  it('cancels the debounced fetch when the effect is cleaned up before it fires', async () => {
    getCommitFilePreviewMock.mockResolvedValue({ hunks: [] } as unknown as GitCommitFilePreview)
    const setFilePreview = jest.fn()
    const setFilePreviewLoading = jest.fn()
    const { React, runLatestEffect } = makeReact()

    const selected = { hash: 'def456' } as never
    const file = { path: 'src/app.ts' } as never

    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: file,
      setFilePreview,
      setFilePreviewLoading,
    })
    const cleanup = runLatestEffect() as () => void

    // Cleanup fires before the debounce elapses (simulating rapid j/k).
    cleanup()
    await advanceAndFlush(150)

    // active === false + timer cleared, so the fetch never fires.
    expect(getCommitFilePreviewMock).not.toHaveBeenCalled()
    // Only the initial setFilePreviewLoading(true) landed.
    expect(setFilePreview).not.toHaveBeenCalled()
    expect(setFilePreviewLoading).toHaveBeenCalledTimes(1)
    expect(setFilePreviewLoading).toHaveBeenCalledWith(true)
  })

  it('cache hit skips the fetch and never toggles loading true', async () => {
    const preview = { hunks: [] } as unknown as GitCommitFilePreview
    getCommitFilePreviewMock.mockResolvedValue(preview)
    const setFilePreview = jest.fn()
    const setFilePreviewLoading = jest.fn()
    const { React, runLatestEffect } = makeReact()

    const selected = { hash: 'abc123' } as never
    const file = { path: 'src/app.ts' } as never

    // First pass: a full fetch, which populates the cache.
    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: file,
      setFilePreview,
      setFilePreviewLoading,
    })
    runLatestEffect()
    await advanceAndFlush(150)

    expect(getCommitFilePreviewMock).toHaveBeenCalledTimes(1)
    setFilePreview.mockClear()
    setFilePreviewLoading.mockClear()

    // Second pass — same (hash, path): re-invoking the hook simulates a
    // re-render (e.g. cursor moved off and back). The shared `useRef` cache
    // serves the preview instantly, with no fetch and no loading flip.
    useCommitFilePreviewHydration(React, {
      git,
      selected,
      selectedDetailFile: file,
      setFilePreview,
      setFilePreviewLoading,
    })
    runLatestEffect()

    expect(getCommitFilePreviewMock).toHaveBeenCalledTimes(1)
    expect(setFilePreview).toHaveBeenCalledWith(preview)
    expect(setFilePreviewLoading).toHaveBeenCalledWith(false)
    expect(setFilePreviewLoading).not.toHaveBeenCalledWith(true)
  })
})
