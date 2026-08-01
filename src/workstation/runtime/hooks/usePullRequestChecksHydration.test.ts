import type * as ReactTypes from 'react'
import {
  usePullRequestChecksHydration,
  type UsePullRequestChecksHydrationDeps,
} from './usePullRequestChecksHydration'

/** Same harness shape as `usePullRequestDiffHydration.test.ts`. */
function hookHarness(): {
  React: typeof ReactTypes
  flushEffect: () => Promise<void>
} {
  let pendingEffect: (() => void | (() => void)) | undefined
  let lastCleanup: (() => void) | undefined
  const React = {
    useEffect: (fn: () => void | (() => void)) => {
      pendingEffect = fn
    },
  } as unknown as typeof ReactTypes
  return {
    React,
    flushEffect: async () => {
      lastCleanup?.()
      const cleanup = pendingEffect?.()
      lastCleanup = typeof cleanup === 'function' ? cleanup : undefined
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

describe('usePullRequestChecksHydration (OSS-1615)', () => {
  function makeDeps(
    overrides: Partial<UsePullRequestChecksHydrationDeps> = {}
  ): UsePullRequestChecksHydrationDeps & {
    setContext: jest.Mock
    setContextStatus: jest.Mock
  } {
    return {
      getPullRequestChecks: jest.fn().mockResolvedValue({ ok: true, checks: [{ name: 'build', conclusion: 'SUCCESS' }] }),
      activeView: 'pull-request',
      pullRequestNumber: 41,
      pullRequestChecks: undefined,
      runtimes: [{}],
      setContext: jest.fn(),
      setContextStatus: jest.fn(),
      ...overrides,
    } as UsePullRequestChecksHydrationDeps & {
      setContext: jest.Mock
      setContextStatus: jest.Mock
    }
  }

  it('fetches checks once the pull-request view is active with a resolved number', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestChecksHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestChecks).toHaveBeenCalledWith(41)
    expect(deps.setContext).toHaveBeenCalled()
    expect(deps.setContextStatus).toHaveBeenCalled()
  })

  it('bails when the view is not pull-request', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ activeView: 'pull-request-triage' })
    usePullRequestChecksHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestChecks).not.toHaveBeenCalled()
  })

  it('bails when no PR number is resolved', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ pullRequestNumber: undefined })
    usePullRequestChecksHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestChecks).not.toHaveBeenCalled()
  })

  it('skips the fetch when checks are already cached', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps({ pullRequestChecks: { ok: true, checks: [] } })
    usePullRequestChecksHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestChecks).not.toHaveBeenCalled()
  })

  it('refetches once the cache is cleared (e.g. after a re-run invalidation)', async () => {
    const { React, flushEffect } = hookHarness()
    const deps = makeDeps()
    usePullRequestChecksHydration(React, deps)
    await flushEffect()
    expect(deps.getPullRequestChecks).toHaveBeenCalledTimes(1)

    usePullRequestChecksHydration(React, { ...deps, pullRequestChecks: undefined })
    await flushEffect()
    expect(deps.getPullRequestChecks).toHaveBeenCalledTimes(2)
  })
})
