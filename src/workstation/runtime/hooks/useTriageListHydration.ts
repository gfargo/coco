/**
 * Triage list hydration hooks (extracted from `app.ts` as part of the
 * OSS-463 app.ts decomposition).
 *
 * Two paired effects per triage surface (issues, pull-request-triage):
 *   1. Lazy-loader: fetches the list when the view becomes active and no
 *      cached data exists.
 *   2. Filter-cycle invalidation: clears the cached list when the user
 *      cycles the filter preset (`f`), so the loader re-fires with the
 *      new filter.
 *
 * Both use the forge facade so dispatch routes to gh/glab/Bitbucket
 * transparently, and both are frame-tagged (#1384) so writes land on
 * the correct repo frame even if a push/pop races the async response.
 *
 * Reproduced verbatim from the inline effects — same dep arrays, same
 * `active` cancellation flag, same `issuedAtDepth` frame-tag, same
 * single-dep invalidation pattern. Behavior-preserving extraction.
 *
 * `React` is injected per the runtime's `getLogInkRuntimeContext(React)`
 * convention.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { ForgeActions } from '../../../git/forgeActions'
import type { IssueFilterPreset, PullRequestFilterPreset } from '../../../git/triageFilterPresets'
import { issueFilterForPreset, pullRequestFilterForPreset } from '../../../git/triageFilterPresets'
import { updateLogInkContextStatus } from '../../chrome/context'
import type { SetContextFn, SetContextStatusFn } from './useRepoStackRuntimes'

/** Best-effort promise unwrap — same helper pattern as other hooks. */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

// ── Issue Triage ──────────────────────────────────────────────────────────────

export type UseIssueTriageHydrationDeps = {
  git: SimpleGit
  forge: ForgeActions
  activeView: string
  /** Current cached issue list (undefined = not yet loaded). */
  issueList: unknown | undefined
  /** The active filter preset id. */
  selectedIssueFilter: IssueFilterPreset
  /** Live frame depth (runtimes.length - 1). */
  frameDepth: number
  /** Ref that always holds the render-fresh frame depth. */
  repoFrameDepthRef: ReactTypes.MutableRefObject<number>
  setContext: SetContextFn
  setContextStatus: SetContextStatusFn
}

export function useIssueTriageHydration(
  React: typeof ReactTypes,
  deps: UseIssueTriageHydrationDeps,
): void {
  const {
    git,
    forge,
    activeView,
    issueList,
    selectedIssueFilter,
    frameDepth,
    repoFrameDepthRef,
    setContext,
    setContextStatus,
  } = deps

  // Loader: fetch when the view is active and no cached data exists.
  React.useEffect(() => {
    if (activeView !== 'issues') return
    if (issueList) return
    const issuedAtDepth = frameDepth
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'issueList', 'loading'),
      issuedAtDepth,
    )
    const filter = issueFilterForPreset(selectedIssueFilter)
    void safe(forge.getIssueList(git, filter)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          issueList: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'issueList', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [
    git,
    frameDepth,
    activeView,
    issueList,
    selectedIssueFilter,
    setContext,
    setContextStatus,
  ])

  // Filter-cycle invalidation: clear cached list so the loader re-fires.
  React.useEffect(() => {
    if (activeView !== 'issues') return
    // #1384 — frame-tag the clear via the render-fresh depth ref.
    const issuedAtDepth = repoFrameDepthRef.current
    setContext(
      (current) => (current.issueList ? { ...current, issueList: undefined } : current),
      issuedAtDepth,
    )
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'issueList', 'idle'),
      issuedAtDepth,
    )
    // Deliberately depends ONLY on the preset — not on activeView — so
    // re-entering the view doesn't re-fire and discard just-loaded data.
  }, [selectedIssueFilter])
}

// ── Pull Request Triage ───────────────────────────────────────────────────────

export type UsePullRequestTriageHydrationDeps = {
  git: SimpleGit
  forge: ForgeActions
  activeView: string
  /** Current cached PR list (undefined = not yet loaded). */
  pullRequestList: unknown | undefined
  /** The active filter preset id. */
  selectedPullRequestFilter: PullRequestFilterPreset
  /** Live frame depth (runtimes.length - 1). */
  frameDepth: number
  /** Ref that always holds the render-fresh frame depth. */
  repoFrameDepthRef: ReactTypes.MutableRefObject<number>
  setContext: SetContextFn
  setContextStatus: SetContextStatusFn
}

export function usePullRequestTriageHydration(
  React: typeof ReactTypes,
  deps: UsePullRequestTriageHydrationDeps,
): void {
  const {
    git,
    forge,
    activeView,
    pullRequestList,
    selectedPullRequestFilter,
    frameDepth,
    repoFrameDepthRef,
    setContext,
    setContextStatus,
  } = deps

  // Loader: fetch when the view is active and no cached data exists.
  React.useEffect(() => {
    if (activeView !== 'pull-request-triage') return
    if (pullRequestList) return
    const issuedAtDepth = frameDepth
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequestList', 'loading'),
      issuedAtDepth,
    )
    const filter = pullRequestFilterForPreset(selectedPullRequestFilter)
    void safe(forge.getPullRequestList(git, filter)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          pullRequestList: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequestList', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [
    git,
    frameDepth,
    activeView,
    pullRequestList,
    selectedPullRequestFilter,
    setContext,
    setContextStatus,
  ])

  // Filter-cycle invalidation: clear cached list so the loader re-fires.
  React.useEffect(() => {
    if (activeView !== 'pull-request-triage') return
    // #1384 — frame-tagged like the issue preset-clear.
    const issuedAtDepth = repoFrameDepthRef.current
    setContext(
      (current) =>
        current.pullRequestList ? { ...current, pullRequestList: undefined } : current,
      issuedAtDepth,
    )
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'),
      issuedAtDepth,
    )
  }, [selectedPullRequestFilter])
}
