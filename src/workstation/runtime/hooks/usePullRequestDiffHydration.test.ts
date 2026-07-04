import type * as ReactTypes from 'react'
import type { PullRequestListOverview } from '../../../git/pullRequestListData'
import {
  PR_DIFF_CACHE_LIMIT,
  createPullRequestDiffCache,
  readPullRequestDiffCache,
  usePullRequestDiffHydration,
  usePullRequestDiffState,
  writePullRequestDiffCache,
  type UsePullRequestDiffHydrationDeps,
} from './usePullRequestDiffHydration'

/**
 * Minimal fake React for the loader hook: `useRef` persists across
 * "renders" (calls) like the real thing, and `useEffect` bodies are
 * captured so the test can flush them (running the previous cleanup
 * first, as React does when deps change).
 */
function hookHarness(): {
  React: typeof ReactTypes
  flushEffect: () => Promise<void>
} {
  const refs: Array<{ current: unknown }> = []
  let refIndex = 0
  let pendingEffect: (() => void | (() => void)) | undefined
  let lastCleanup: (() => void) | undefined
  const React = {
    useRef: (initial: unknown) => {
      if (refIndex >= refs.length) refs.push({ current: initial })
      return refs[refIndex++]
    },
    useEffect: (fn: () => void | (() => void)) => {
      pendingEffect = fn
    },
  } as unknown as typeof ReactTypes
  return {
    React,
    flushEffect: async () => {
      refIndex = 0
      lastCleanup?.()
      const cleanup = pendingEffect?.()
      lastCleanup = typeof cleanup === 'function' ? cleanup : undefined
      // Let the async loader body settle.
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

const overview = (tag: string): PullRequestListOverview =>
  ({ available: true, authenticated: true, pullRequests: [], message: tag } as PullRequestListOverview)

describe('PR diff cache (#1363)', () => {
  it('round-trips entries within one generation', () => {
    const cache = createPullRequestDiffCache()
    const gen = overview('a')
    writePullRequestDiffCache(cache, gen, 7, ['diff --git a/x b/x'])
    expect(readPullRequestDiffCache(cache, gen, 7)).toEqual(['diff --git a/x b/x'])
    expect(readPullRequestDiffCache(cache, gen, 8)).toBeUndefined()
  })

  it('invalidates every entry when the generation (triage list identity) changes', () => {
    const cache = createPullRequestDiffCache()
    const before = overview('before')
    writePullRequestDiffCache(cache, before, 7, ['old patch'])
    // Refresh / filter change replaces the overview object.
    const after = overview('after')
    expect(readPullRequestDiffCache(cache, after, 7)).toBeUndefined()
    // And the old generation's entries are gone for good — a flip back
    // to the same number under the new generation refetches.
    writePullRequestDiffCache(cache, after, 7, ['new patch'])
    expect(readPullRequestDiffCache(cache, after, 7)).toEqual(['new patch'])
  })

  it(`is bounded to the last ${PR_DIFF_CACHE_LIMIT} patches, LRU-evicted`, () => {
    const cache = createPullRequestDiffCache()
    const gen = overview('gen')
    for (let n = 1; n <= PR_DIFF_CACHE_LIMIT; n += 1) {
      writePullRequestDiffCache(cache, gen, n, [`patch ${n}`])
    }
    // Touch #1 so #2 becomes the least-recently-used entry.
    expect(readPullRequestDiffCache(cache, gen, 1)).toEqual(['patch 1'])
    writePullRequestDiffCache(cache, gen, PR_DIFF_CACHE_LIMIT + 1, ['patch new'])
    expect(cache.entries.size).toBe(PR_DIFF_CACHE_LIMIT)
    expect(readPullRequestDiffCache(cache, gen, 2)).toBeUndefined()
    expect(readPullRequestDiffCache(cache, gen, 1)).toEqual(['patch 1'])
    expect(readPullRequestDiffCache(cache, gen, PR_DIFF_CACHE_LIMIT + 1)).toEqual(['patch new'])
  })
})

describe('usePullRequestDiffState', () => {
  it('owns three slots: lines (undefined), loading (false), error (undefined)', () => {
    const states: unknown[] = []
    const React = {
      useState: (init: unknown) => {
        states.push(init)
        return [init, jest.fn()]
      },
    } as unknown as typeof ReactTypes
    const slots = usePullRequestDiffState(React)
    expect(states).toEqual([undefined, false, undefined])
    expect(slots.prDiffLines).toBeUndefined()
    expect(slots.prDiffLoading).toBe(false)
    expect(slots.prDiffError).toBeUndefined()
  })
})

describe('usePullRequestDiffHydration', () => {
  function makeDeps(
    overrides: Partial<UsePullRequestDiffHydrationDeps> = {}
  ): UsePullRequestDiffHydrationDeps & {
    setPrDiffLines: jest.Mock
    setPrDiffLoading: jest.Mock
    setPrDiffError: jest.Mock
  } {
    return {
      getPullRequestDiffByNumber: jest.fn().mockResolvedValue({ ok: true, lines: ['+x'] }),
      activeView: 'diff',
      diffSource: 'pr',
      prDiffNumber: 41,
      pullRequestList: overview('gen-1'),
      refreshToken: 0,
      setPrDiffLines: jest.fn(),
      setPrDiffLoading: jest.fn(),
      setPrDiffError: jest.fn(),
      ...overrides,
    } as UsePullRequestDiffHydrationDeps & {
      setPrDiffLines: jest.Mock
      setPrDiffLoading: jest.Mock
      setPrDiffError: jest.Mock
    }
  }

  it('loads the patch once the diff view is active with diffSource=pr', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledWith(41)
    expect(deps.setPrDiffLoading).toHaveBeenNthCalledWith(1, true)
    expect(deps.setPrDiffLines).toHaveBeenCalledWith(['+x'])
    expect(deps.setPrDiffLoading).toHaveBeenLastCalledWith(false)
  })

  // Unrolled (not a loop) so react-hooks/rules-of-hooks doesn't flag the
  // harnessed hook call — each case gets its own fresh harness anyway.
  it('bails (and clears the loading flag) when the diff view is not active', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ activeView: 'pull-request-triage' })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).not.toHaveBeenCalled()
    expect(deps.setPrDiffLoading).toHaveBeenCalledWith(false)
  })

  it('bails when the diff is not PR-sourced (stash/commit/compare/worktree)', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ diffSource: 'stash' })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).not.toHaveBeenCalled()
    expect(deps.setPrDiffLoading).toHaveBeenCalledWith(false)
  })

  it('bails when no PR number is recorded', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ prDiffNumber: undefined })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).not.toHaveBeenCalled()
    expect(deps.setPrDiffLoading).toHaveBeenCalledWith(false)
  })

  it('serves a repeat open from the cache without refetching', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(1)

    // Pop back to the list…
    usePullRequestDiffHydration(React, { ...deps, activeView: 'pull-request-triage' })
    await flushEffect()
    // …and re-open the same PR: cache hit, no second fetch, no loading flash.
    deps.setPrDiffLoading.mockClear()
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(1)
    expect(deps.setPrDiffLines).toHaveBeenLastCalledWith(['+x'])
    expect(deps.setPrDiffLoading).not.toHaveBeenCalledWith(true)
  })

  it('refetches after the triage list refreshes (new overview identity)', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    usePullRequestDiffHydration(React, { ...deps, pullRequestList: overview('gen-2') })
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(2)
  })

  it('surfaces a fetch failure via setPrDiffError (and does not cache it)', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({
      getPullRequestDiffByNumber: jest
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'auth expired' })
        .mockResolvedValue({ ok: true, lines: ['+fixed'] }),
    })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.setPrDiffError).toHaveBeenCalledWith('auth expired')
    expect(deps.setPrDiffLines).toHaveBeenCalledWith([])

    // A retry (same deps re-fired) must hit the network again — errors
    // are never cached.
    usePullRequestDiffHydration(React, { ...deps, prDiffNumber: 41 })
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(2)
    expect(deps.setPrDiffLines).toHaveBeenLastCalledWith(['+fixed'])
    expect(deps.setPrDiffError).toHaveBeenLastCalledWith(undefined)
  })

  it('a refreshToken bump alone (OSS-452) is a cache hit — same generation, no refetch', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(1)

    // A background refresh preserved `pullRequestList`'s reference (the
    // OSS-452 fix) but still bumps the token so the effect re-evaluates.
    deps.setPrDiffLoading.mockClear()
    usePullRequestDiffHydration(React, { ...deps, refreshToken: 1 })
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(1)
    expect(deps.setPrDiffLines).toHaveBeenLastCalledWith(['+x'])
    expect(deps.setPrDiffLoading).not.toHaveBeenCalledWith(true)
  })

  it('a refreshToken bump after a failed fetch (OSS-452) retries and clears the error', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({
      getPullRequestDiffByNumber: jest
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'network error' })
        .mockResolvedValue({ ok: true, lines: ['+recovered'] }),
    })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    expect(deps.setPrDiffError).toHaveBeenCalledWith('network error')

    // Same `pullRequestList` reference (no triage refetch), but a silent
    // background refresh bumped the token — retry must fire, not go inert.
    usePullRequestDiffHydration(React, { ...deps, refreshToken: 1 })
    await flushEffect()
    expect(deps.getPullRequestDiffByNumber).toHaveBeenCalledTimes(2)
    expect(deps.setPrDiffLines).toHaveBeenLastCalledWith(['+recovered'])
    expect(deps.setPrDiffError).toHaveBeenLastCalledWith(undefined)
  })

  it('drops a stale in-flight resolve after cleanup (active flag)', async () => {
    const { React, flushEffect } = hookHarness()
    let resolveFetch: (value: { ok: true; lines: string[] }) => void = () => undefined
    const deps = makeDeps({
      getPullRequestDiffByNumber: jest.fn().mockReturnValue(
        new Promise((resolve) => { resolveFetch = resolve })
      ),
    })
    usePullRequestDiffHydration(React, deps)
    await flushEffect()
    // Navigate away — the next flush runs the cleanup for the in-flight
    // effect before the guard-bail effect.
    usePullRequestDiffHydration(React, { ...deps, diffSource: undefined })
    await flushEffect()
    deps.setPrDiffLines.mockClear()
    resolveFetch({ ok: true, lines: ['+stale'] })
    await new Promise((resolve) => setImmediate(resolve))
    expect(deps.setPrDiffLines).not.toHaveBeenCalled()
  })
})
