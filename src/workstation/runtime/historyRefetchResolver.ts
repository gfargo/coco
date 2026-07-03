import type { LogArgv } from '../../commands/log/config'
import { buildToggleGraphArgs } from '../../commands/log/data'
import type { LogInkHistoryFetchArgs } from './inkViewModel'

/**
 * Pure decision logic for the merged history-refetch effect (#1385).
 *
 * The workstation used to run TWO sibling effects against the history
 * rows: one keyed on `state.historyFetchArgs` (server-side `author:` /
 * `path:` filters, #776) and one keyed on `state.fullGraph` (the `g`
 * graph toggle, #791 follow-up). Both listed the active frame's `git`
 * in their dependency arrays with mount-consumed first-run-skip refs,
 * so every repo-frame drill-in/out re-ran BOTH bodies — two concurrent
 * `getLogRows` calls whose argv genuinely diverged (the filter fetch
 * ignored `fullGraph`; the graph fetch ignored the filter), with
 * whichever resolved last deciding what the frame showed.
 *
 * This module owns the two decisions the merged effect needs, so they
 * can be unit tested without driving the full runtime (same pattern as
 * `loadMoreResolver` / `cursorSyncResolver`):
 *
 *   - `buildHistoryRefetchArgv` — derive ONE argv from the full
 *     (logArgv, fullGraph, fetchArgs) picture, so a graph toggle keeps
 *     the active filter and a filter submit keeps the graph mode.
 *
 *   - `resolveHistoryRefetch` — pick the status copy for the fetch
 *     based on WHICH input changed (filter submit, graph toggle, or a
 *     repo-frame switch), preserving the per-trigger wording the two
 *     original effects used.
 *
 * The async plumbing (stash-hash collection, the fetch itself, the
 * request-id stale guard, dispatches) stays in `app.ts`.
 */

/** What caused the refetch — decides the status-line copy. */
export type HistoryRefetchTrigger = 'filter' | 'graph' | 'frame'

export type HistoryRefetchInput = {
  /** The boot log argv (the merge base every refetch starts from). */
  logArgv: LogArgv
  /** Current graph mode (`state.fullGraph`). */
  fullGraph: boolean
  /** Current server-side filter (`state.historyFetchArgs`), if any. */
  fetchArgs: LogInkHistoryFetchArgs | undefined
  /** Whether `state.historyFetchArgs` changed since the last effect run. */
  fetchArgsChanged: boolean
  /** Whether `state.fullGraph` changed since the last effect run. */
  fullGraphChanged: boolean
}

export type HistoryRefetchPlan = {
  /** The single merged argv the fetch must use. */
  argv: LogArgv
  trigger: HistoryRefetchTrigger
  /** Status line shown while the fetch is in flight. */
  pendingStatus: string
  /** Status line shown when the fetch fails. */
  errorStatus: string
  /** Status line shown on success, given the fetched commit count. */
  successStatus: (matched: number) => string
}

/**
 * Derive the single merged argv for a history refetch: graph mode
 * first (`buildToggleGraphArgs` maps `fullGraph` onto `view`), then
 * the server-side filter overlay. Both the filter submit and the
 * graph toggle now consult the OTHER dimension's current state, so
 * concurrent triggers can never produce divergent fetches.
 */
export function buildHistoryRefetchArgv(
  logArgv: LogArgv,
  fullGraph: boolean,
  fetchArgs: LogInkHistoryFetchArgs | undefined,
): LogArgv {
  return {
    ...buildToggleGraphArgs(logArgv, fullGraph),
    ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
    ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
  }
}

/**
 * Human description of the active server-side filter — `author:foo` /
 * `path:bar` — or undefined when no filter is active. Mirrors the copy
 * the original filter effect produced.
 */
function describeFetchArgs(fetchArgs: LogInkHistoryFetchArgs | undefined): string | undefined {
  if (fetchArgs?.author) return `author:${fetchArgs.author}`
  if (fetchArgs?.path) return `path:${fetchArgs.path}`
  return undefined
}

/**
 * Build the full refetch plan: merged argv + trigger-appropriate
 * status copy.
 *
 * Trigger precedence: a filter change wins over a graph change (both
 * changing in one pass is not reachable from single keystrokes, but a
 * deterministic answer beats an arbitrary one), and a run where
 * neither changed can only mean the effect re-fired because the
 * active frame's `git` / `logArgv` changed — a repo-frame switch,
 * which gets neutral "loading history" copy instead of the two
 * contradictory status lines the old twin effects raced onto the
 * status bar.
 */
export function resolveHistoryRefetch(input: HistoryRefetchInput): HistoryRefetchPlan {
  const { logArgv, fullGraph, fetchArgs, fetchArgsChanged, fullGraphChanged } = input
  const argv = buildHistoryRefetchArgv(logArgv, fullGraph, fetchArgs)

  if (fetchArgsChanged) {
    const description = describeFetchArgs(fetchArgs)
    return {
      argv,
      trigger: 'filter',
      pendingStatus: description ? `Refetching with ${description}` : 'Restoring full log',
      errorStatus: 'Failed to refetch with active filter',
      successStatus: (matched) =>
        description ? `Showing ${matched} commits matching ${description}` : 'Showing full log',
    }
  }

  if (fullGraphChanged) {
    return {
      argv,
      trigger: 'graph',
      pendingStatus: fullGraph ? 'Loading full topology…' : 'Loading compact history…',
      errorStatus: 'Failed to refetch graph rows',
      successStatus: (matched) =>
        fullGraph
          ? `Showing ${matched} commits across all branches`
          : `Showing ${matched} commits (compact)`,
    }
  }

  return {
    argv,
    trigger: 'frame',
    pendingStatus: 'Loading history…',
    errorStatus: 'Failed to load history',
    successStatus: (matched) => `Showing ${matched} commits`,
  }
}
