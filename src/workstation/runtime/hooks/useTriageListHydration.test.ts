import {
  useIssueTriageHydration,
  usePullRequestTriageHydration,
} from './useTriageListHydration'
import { updateLogInkContextStatus } from '../../chrome/context'

/**
 * Regression tests for #1633 — an unexpected rejection (e.g. repository
 * resolution failing above the forge's own gh-CLI error handling) used to be
 * swallowed into bare `undefined` by the old `safe()` helper, which reads
 * through the render layer as "still loading" forever. The fix routes any
 * rejection through the same `{ available, authenticated, message }` shape
 * the triage surfaces already render as an actionable error line.
 *
 * Minimal fake-React harness (same shape as useCommitDetailHydration.test.ts):
 * records `useEffect` callbacks so the test can invoke the loader effect
 * (the first one registered) directly.
 */

type EffectFn = () => void | (() => void)

function makeReact(): {
  React: typeof import('react')
  runLoaderEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
  } as unknown as typeof import('react')
  return {
    React,
    runLoaderEffect: () => {
      if (effects.length !== 2) {
        throw new Error(`expected exactly two effects, got ${effects.length}`)
      }
      // The loader effect is registered first, the filter-invalidation
      // effect second (see useTriageListHydration.ts source order).
      return effects[0]()
    },
  }
}

/** Flush pending microtasks so the effect's chained promise settles. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const git = {} as Parameters<typeof useIssueTriageHydration>[1]['git']
const repoFrameDepthRef = { current: 0 }

describe('useIssueTriageHydration', () => {
  it('surfaces an unexpected getIssueList rejection as an actionable overview instead of undefined', async () => {
    const forge = {
      getIssueList: jest.fn().mockRejectedValue(new Error('no repository resolved')),
    } as unknown as Parameters<typeof useIssueTriageHydration>[1]['forge']
    const setContext = jest.fn()
    const setContextStatus = jest.fn()
    const { React, runLoaderEffect } = makeReact()

    useIssueTriageHydration(React, {
      git,
      forge,
      activeView: 'issues',
      issueList: undefined,
      selectedIssueFilter: 'open',
      frameDepth: 0,
      repoFrameDepthRef,
      setContext,
      setContextStatus,
    })
    runLoaderEffect()
    await flush()

    const contextUpdater = setContext.mock.calls[0][0] as (
      prev: Record<string, unknown>,
    ) => Record<string, unknown>
    const next = contextUpdater({})
    expect(next.issueList).toEqual({
      available: true,
      authenticated: true,
      message: 'no repository resolved',
    })

    // The status must still resolve to 'ready' — not stuck on 'loading'.
    const statusUpdater = setContextStatus.mock.calls[
      setContextStatus.mock.calls.length - 1
    ][0] as (prev: ReturnType<typeof updateLogInkContextStatus>) => unknown
    const nextStatus = statusUpdater(
      updateLogInkContextStatus(
        { issueList: 'loading' } as never,
        'issueList',
        'loading',
      ),
    ) as { issueList: string }
    expect(nextStatus.issueList).toBe('ready')
  })
})

describe('usePullRequestTriageHydration', () => {
  it('surfaces an unexpected getPullRequestList rejection as an actionable overview instead of undefined', async () => {
    const forge = {
      getPullRequestList: jest.fn().mockRejectedValue(new Error('gh not found')),
    } as unknown as Parameters<typeof usePullRequestTriageHydration>[1]['forge']
    const setContext = jest.fn()
    const setContextStatus = jest.fn()
    const { React, runLoaderEffect } = makeReact()

    usePullRequestTriageHydration(React, {
      git,
      forge,
      activeView: 'pull-request-triage',
      pullRequestList: undefined,
      selectedPullRequestFilter: 'open',
      frameDepth: 0,
      repoFrameDepthRef,
      setContext,
      setContextStatus,
    })
    runLoaderEffect()
    await flush()

    const contextUpdater = setContext.mock.calls[0][0] as (
      prev: Record<string, unknown>,
    ) => Record<string, unknown>
    const next = contextUpdater({})
    expect(next.pullRequestList).toEqual({
      available: true,
      authenticated: true,
      message: 'gh not found',
    })

    const statusUpdater = setContextStatus.mock.calls[
      setContextStatus.mock.calls.length - 1
    ][0] as (prev: ReturnType<typeof updateLogInkContextStatus>) => unknown
    const nextStatus = statusUpdater(
      updateLogInkContextStatus(
        { pullRequestList: 'loading' } as never,
        'pullRequestList',
        'loading',
      ),
    ) as { pullRequestList: string }
    expect(nextStatus.pullRequestList).toBe('ready')
  })
})
