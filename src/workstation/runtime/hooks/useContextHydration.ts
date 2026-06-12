/**
 * Context hydration effects (extracted in the 0.72 app.ts decomposition,
 * PR 9).
 *
 * This module lifts the two effects that load the MAIN context for the
 * active view into the active repo-stack frame's `context` /
 * `contextStatus`:
 *
 *   1. Boot load     — fires on every `git` swap (mount, drill-in,
 *      drill-out). Iterates the per-key boot loaders from
 *      `loadLogInkContextEntries(git)`, skips any key already `'ready'`
 *      (read through `contextStatusRef`, NOT the `contextStatus` dep, so
 *      the effect's own per-key `'ready'` writes don't re-fire it), and
 *      writes each resolved value + `'ready'` status as it lands.
 *   2. PR overview   — lazily loads the full `pullRequest` overview (#808)
 *      the first time the user navigates to the PR view and only when it
 *      isn't already cached.
 *
 * Both effects:
 *   - capture the `issuedAtDepth = runtimes.length - 1` frame-tag
 *     **BEFORE the await** and pass it to `setContext` / `setContextStatus`
 *     so an in-flight load lands on the repo-stack frame that issued it,
 *     not whichever frame is on top when the fetch resolves (#994);
 *   - guard stale results with an `active` flag flipped false in cleanup.
 *
 * The two effects are reproduced **verbatim and separate** — the per-key
 * gate, the `contextStatusRef` read, the `active` cancellation flag, the
 * view / cache guards, the `issuedAtDepth` capture-before-await, and the
 * dependency arrays are byte-for-byte the same as the original `app.ts`
 * cluster. This is a behavior-preserving move, not a rewrite. They are
 * adjacent in `app.ts` and stay adjacent here (one hook, two effects in
 * order).
 *
 * `loadLogInkContextEntries` (the boot per-key loader table) and
 * `contextStatusRef` (the latest-status ref) live in `app.ts` and are
 * injected so the move stays faithful without relocating unrelated
 * module-local helpers.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getForgePullRequestOverview } from '../../../git/forgeActions'
import type {
  LogInkContextKey,
  LogInkContextStatus,
} from '../../chrome/context'
import { updateLogInkContextStatus } from '../../chrome/context'
import type { LogInkView } from '../inkViewModel'
import type { LogInkContext } from '../types'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a failed fetch leaves the existing context on screen instead
 * of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

/**
 * Pure gate for the per-key boot load: hydrate a key only when it isn't
 * already `'ready'`. Mirrors the inline guard
 * `if (contextStatusRef.current[key] === 'ready') return` — returns `false`
 * when the key is already loaded (skip the fetch), `true` otherwise
 * (hydrate). Pulled out so the "skip already-ready keys" decision is
 * unit-testable without spinning React, a repo stack, or the loader table.
 *
 * The boot-load effect keeps its check inline and byte-for-byte; this helper
 * documents and tests the decision rather than replacing it.
 */
export function shouldHydrateContextKey(
  status: LogInkContextStatus,
  key: LogInkContextKey,
): boolean {
  return status[key] !== 'ready'
}

export type UseContextHydrationDeps = {
  /** The active frame's `git`. Drives both boot and PR-overview fetches. */
  git: SimpleGit
  /** `state.activeView` — only `'pull-request'` triggers the PR overview. */
  activeView: LogInkView
  /**
   * The active frame's loaded context. `context.pullRequest` is the cache
   * guard for the PR-overview effect.
   */
  context: LogInkContext
  /** Repo-stack runtimes — `runtimes.length - 1` is the frame-tag depth. */
  runtimes: readonly unknown[]
  /**
   * The boot per-key loader table (`loadLogInkContextEntries`), kept in
   * `app.ts`. Each entry resolves one context key.
   */
  loadLogInkContextEntries: (git: SimpleGit) => Array<{
    key: LogInkContextKey
    load: () => Promise<LogInkContext[LogInkContextKey] | undefined>
  }>
  /**
   * Latest-status ref (`contextStatusRef`), kept in `app.ts`. Read inside
   * the boot effect so its own per-key `'ready'` writes don't re-trigger it.
   */
  contextStatusRef: ReactTypes.MutableRefObject<LogInkContextStatus>
  /** Frame-tagging context writer (`setContext(next, issuedAtDepth)`). */
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
  /** Frame-tagging status writer (`setContextStatus(next, issuedAtDepth)`). */
  setContextStatus: (
    arg:
      | LogInkContextStatus
      | ((prev: LogInkContextStatus) => LogInkContextStatus),
    targetDepth?: number,
  ) => void
}

/**
 * Issues the boot-load and PR-overview context-hydration effects, in their
 * original `app.ts` order and position (boot load, then PR overview). Each
 * effect is reproduced verbatim — same per-key / view / cache guards, same
 * `active` cancellation flag, same `issuedAtDepth = runtimes.length - 1`
 * frame-tag captured *before* the `await`, same dependency array.
 */
export function useContextHydration(
  React: typeof ReactTypes,
  deps: UseContextHydrationDeps,
): void {
  const {
    git,
    activeView,
    context,
    runtimes,
    loadLogInkContextEntries,
    contextStatusRef,
    setContext,
    setContextStatus,
  } = deps

  React.useEffect(() => {
    // #994 — capture the depth this boot load is being issued for.
    // The git instance in the closure is bound to this frame; tagged
    // writes ensure resolved values land on the correct runtime entry
    // even if a subsequent push/pop changes the active frame mid-load.
    const issuedAtDepth = runtimes.length - 1
    let active = true

    loadLogInkContextEntries(git).forEach(({ key, load }) => {
      if (contextStatusRef.current[key] === 'ready') return
      void load().then((value) => {
        if (!active) {
          return
        }

        setContext(
          (current) => ({
            ...current,
            [key]: value,
          }),
          issuedAtDepth,
        )
        setContextStatus(
          (current) => updateLogInkContextStatus(current, key, 'ready'),
          issuedAtDepth,
        )
      })
    })

    return () => {
      active = false
    }
  }, [git, runtimes.length, setContext, setContextStatus])

  // Lazy-load the full pullRequest overview (#808). Only fires when
  // the user actually navigates to the PR view, and only when we
  // don't already have data (so a workflow-triggered refresh that
  // hydrated `pullRequest` doesn't re-fetch on view entry). The
  // dedicated PR view shows its own loading state while this is in
  // flight; everywhere else (header glyph, yank, workflow runner)
  // already falls through to the slim `provider.currentPullRequest`
  // so the chrome stays populated immediately on boot.
  React.useEffect(() => {
    if (activeView !== 'pull-request') return
    if (context.pullRequest) return
    const issuedAtDepth = runtimes.length - 1
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequest', 'loading'),
      issuedAtDepth,
    )
    void safe(getForgePullRequestOverview(git)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          pullRequest: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequest', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [git, runtimes.length, activeView, context.pullRequest, setContext, setContextStatus])
}
