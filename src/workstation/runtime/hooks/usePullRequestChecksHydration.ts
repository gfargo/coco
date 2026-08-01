/**
 * Lazy hydration for the per-check breakdown of the current branch's PR
 * (OSS-1615). Mirrors `useContextHydration`'s PR-overview effect — fires
 * once on entry to the `pull-request` view and only when the cache
 * (`context.pullRequestChecks`) is empty, so a re-run's cache-clear is
 * what triggers a refetch, not every render.
 *
 * Needs `forge.getPullRequestChecks`, which is only available after
 * `useForgeAdapter` resolves in `app.ts` — kept as its own hook rather
 * than folded into `useContextHydration` (which runs earlier, before
 * `forge` exists) to avoid reordering hooks.
 */

import type * as ReactTypes from 'react'
import type { PullRequestChecksResult } from '../../../git/pullRequestDetailData'
import type { LogInkContextStatus } from '../../chrome/context'
import { updateLogInkContextStatus } from '../../chrome/context'
import type { LogInkView } from '../inkViewModel'
import type { LogInkContext } from '../types'

export type UsePullRequestChecksHydrationDeps = {
  /** `forge.getPullRequestChecks` — identity-stable, memoized in `useForgeAdapter`. */
  getPullRequestChecks: (n: number) => Promise<PullRequestChecksResult>
  /** `state.activeView` — only `'pull-request'` triggers the fetch. */
  activeView: LogInkView
  /** The current branch's PR number, resolved the same way the `K`/`M` handlers do. */
  pullRequestNumber: number | undefined
  /** Cache guard — skip the fetch when already hydrated. */
  pullRequestChecks: PullRequestChecksResult | undefined
  runtimes: readonly unknown[]
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
  setContextStatus: (
    arg: LogInkContextStatus | ((prev: LogInkContextStatus) => LogInkContextStatus),
    targetDepth?: number,
  ) => void
}

export function usePullRequestChecksHydration(
  React: typeof ReactTypes,
  deps: UsePullRequestChecksHydrationDeps,
): void {
  const {
    getPullRequestChecks,
    activeView,
    pullRequestNumber,
    pullRequestChecks,
    runtimes,
    setContext,
    setContextStatus,
  } = deps

  React.useEffect(() => {
    if (activeView !== 'pull-request') return
    if (!pullRequestNumber) return
    if (pullRequestChecks) return
    const issuedAtDepth = runtimes.length - 1
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequestChecks', 'loading'),
      issuedAtDepth,
    )
    void getPullRequestChecks(pullRequestNumber).then((result) => {
      if (!active) return
      setContext(
        (current) => ({ ...current, pullRequestChecks: result }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequestChecks', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [getPullRequestChecks, activeView, pullRequestNumber, pullRequestChecks, runtimes.length, setContext, setContextStatus])
}
