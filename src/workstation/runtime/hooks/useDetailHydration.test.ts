import type * as ReactTypes from 'react'
import {
  BLAME_HYDRATION_DELAY_MS,
  DETAIL_HYDRATION_DELAY_MS,
  shouldHydrate,
  useDetailHydration,
  type UseDetailHydrationDeps,
} from './useDetailHydration'
import { createLogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import type { ForgeActions } from '../../../git/forgeActions'

/**
 * Unit tests for the pure `shouldHydrate` core (0.72 app.ts decomposition,
 * PR 7). No React harness — the hook (`useDetailHydration`) is a verbatim
 * lift of three debounced effects, validated by the green build; only the
 * extracted "fetch only if not already cached" decision is exercised here.
 */
describe('shouldHydrate', () => {
  it('hydrates (true) when the cache is undefined', () => {
    expect(shouldHydrate(42, undefined)).toBe(true)
    expect(shouldHydrate('src/app.ts', undefined)).toBe(true)
  })

  it('hydrates (true) when the key is absent from the cache', () => {
    const cache = new Map<number, unknown>([[1, {}]])
    expect(shouldHydrate(2, cache)).toBe(true)
  })

  it('skips (false) when the key is already cached', () => {
    const cache = new Map<number, unknown>([[7, {}]])
    expect(shouldHydrate(7, cache)).toBe(false)
  })

  it('skips (false) for a cached path key', () => {
    const cache = new Map<string, unknown>([['src/app.ts', {}]])
    expect(shouldHydrate('src/app.ts', cache)).toBe(false)
  })

  it('treats a key cached with a falsy value as present (skip)', () => {
    // `.has` is what the guard keys off, not the stored value — a cached
    // entry whose value is falsy must still suppress a refetch.
    const cache = new Map<number, unknown>([[0, undefined]])
    expect(shouldHydrate(0, cache)).toBe(false)
  })
})

describe('debounce constants', () => {
  it('preserves the issue / PR detail debounce window verbatim', () => {
    expect(DETAIL_HYDRATION_DELAY_MS).toBe(250)
  })

  it('preserves the blame debounce window verbatim', () => {
    expect(BLAME_HYDRATION_DELAY_MS).toBe(150)
  })
})

/**
 * Behavioral tests for the review-threads hydration effect (OSS-2404),
 * the sixth and last effect `useDetailHydration` issues. Only this last
 * effect is exercised — `useDetailHydration` registers all six via
 * `React.useEffect` in one call, and the harness records each in
 * registration order so the test can invoke just the one under test
 * without satisfying the other five's preconditions.
 */
describe('useDetailHydration — review threads (OSS-2404)', () => {
  type EffectFn = () => void | (() => void)

  function makeReact(): { React: typeof ReactTypes; effects: EffectFn[] } {
    const effects: EffectFn[] = []
    const React = {
      useEffect: (fn: EffectFn) => {
        effects.push(fn)
      },
    } as unknown as typeof ReactTypes
    return { React, effects }
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  const advanceAndFlush = async (ms: number): Promise<void> => {
    jest.advanceTimersByTime(ms)
    await flush()
  }

  function makeDeps(
    overrides: Partial<UseDetailHydrationDeps> = {}
  ): UseDetailHydrationDeps & { setContext: jest.Mock } {
    const getPullRequestReviewThreads = jest.fn().mockResolvedValue({ ok: true, threads: [] })
    return {
      git: {} as UseDetailHydrationDeps['git'],
      forge: { getPullRequestReviewThreads } as unknown as ForgeActions,
      state: { ...createLogInkState([]), activeView: 'pull-request', inspectorTab: 'threads' },
      context: {} as LogInkContext,
      runtimes: [{}],
      filteredIssueList: [],
      filteredPullRequestTriageList: [],
      setContext: jest.fn(),
      setBlameLoading: jest.fn(),
      setFileHistoryLoading: jest.fn(),
      setBlameFailure: jest.fn(),
      setFileHistoryFailure: jest.fn(),
      ...overrides,
    } as UseDetailHydrationDeps & { setContext: jest.Mock }
  }

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('debounces 250ms, then fetches the current branch PR number and caches the result', async () => {
    const { React, effects } = makeReact()
    const deps = makeDeps({
      context: { pullRequest: { available: true, authenticated: true, currentPullRequest: { number: 41 } as never } } as LogInkContext,
    })
    useDetailHydration(React, deps)
    effects[effects.length - 1]()
    expect((deps.forge.getPullRequestReviewThreads as jest.Mock)).not.toHaveBeenCalled()

    await advanceAndFlush(DETAIL_HYDRATION_DELAY_MS)

    expect(deps.forge.getPullRequestReviewThreads).toHaveBeenCalledWith(41)
    expect(deps.setContext).toHaveBeenCalled()
  })

  it('bails when the view is not pull-request', async () => {
    const { React, effects } = makeReact()
    const deps = makeDeps({
      state: { ...createLogInkState([]), activeView: 'history', inspectorTab: 'threads' },
      context: { pullRequest: { available: true, authenticated: true, currentPullRequest: { number: 41 } as never } } as LogInkContext,
    })
    useDetailHydration(React, deps)
    effects[effects.length - 1]()
    await advanceAndFlush(DETAIL_HYDRATION_DELAY_MS)
    expect(deps.forge.getPullRequestReviewThreads).not.toHaveBeenCalled()
  })

  it('bails when the Threads tab is not active', async () => {
    const { React, effects } = makeReact()
    const deps = makeDeps({
      state: { ...createLogInkState([]), activeView: 'pull-request', inspectorTab: 'inspector' },
      context: { pullRequest: { available: true, authenticated: true, currentPullRequest: { number: 41 } as never } } as LogInkContext,
    })
    useDetailHydration(React, deps)
    effects[effects.length - 1]()
    await advanceAndFlush(DETAIL_HYDRATION_DELAY_MS)
    expect(deps.forge.getPullRequestReviewThreads).not.toHaveBeenCalled()
  })

  it('bails when no PR number resolves for the current branch', async () => {
    const { React, effects } = makeReact()
    const deps = makeDeps({ context: {} as LogInkContext })
    useDetailHydration(React, deps)
    effects[effects.length - 1]()
    await advanceAndFlush(DETAIL_HYDRATION_DELAY_MS)
    expect(deps.forge.getPullRequestReviewThreads).not.toHaveBeenCalled()
  })

  it('skips the fetch when the number is already cached, including a cached unsupported result', async () => {
    const { React, effects } = makeReact()
    const deps = makeDeps({
      context: {
        pullRequest: { available: true, authenticated: true, currentPullRequest: { number: 41 } as never },
        reviewThreadsByNumber: new Map([[41, { ok: false, message: 'not supported' }]]),
      } as LogInkContext,
    })
    useDetailHydration(React, deps)
    effects[effects.length - 1]()
    await advanceAndFlush(DETAIL_HYDRATION_DELAY_MS)
    expect(deps.forge.getPullRequestReviewThreads).not.toHaveBeenCalled()
  })
})
