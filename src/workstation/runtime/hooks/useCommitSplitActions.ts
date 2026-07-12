/**
 * Commit-split action handlers (extracted in the 0.72 app.ts decomposition —
 * the third action-callback extraction, after `useWorktreeStageActions` and
 * `useCommitComposeActions`).
 *
 * This module lifts the three contiguous commit-split `React.useCallback`
 * handlers out of `app.ts`, in original declaration order, preserving their
 * behavior verbatim:
 *
 *   1. `startCommitSplit` — `S` keystroke. Pre-flight refuses cleanly when
 *      nothing is staged or a bisect / merge / rebase is in progress, opens
 *      the overlay in 'loading' state via `runCommitSplitPlanWorkflow({ git })`,
 *      then dispatches `setSplitPlanReady` (or `setSplitPlanError`).
 *   2. `applyCommitSplit` — `y`/Enter inside the overlay. Reads
 *      `state.splitPlan.{plan, planContext, fallback}`, runs
 *      `runCommitSplitApplyWorkflow()`, writes a best-effort diagnostic dump to
 *      `/tmp`, refreshes via `refreshHistoryRows` / `refreshWorktreeContext` /
 *      `refreshContext`, and routes the user home (or to status) with the
 *      `markRecentCommits` marker firing on the just-landed commits.
 *   3. `cancelCommitSplit` — Esc inside the overlay. Clears the plan and
 *      confirms on the status line.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * byte-for-byte: the diagnostic-dump path/format, the refresh/dispatch
 * sequencing in the apply path (the exact order of `refreshHistoryRows` /
 * `refreshWorktreeContext` / `refreshContext` and the
 * `clearSplitPlan` / `commitCompose` / `navigateHome` / `pushView` /
 * `markRecentCommits` dispatches — reordering any of these would change the
 * post-apply UI state), and the guard conditions are all unchanged. This is a
 * behavior-preserving move, not a rewrite; the three are deliberately NOT
 * consolidated despite sharing the `state.splitPlan` orchestration.
 *
 * Hook ordering / identity. The three callbacks are contiguous in `app.ts`
 * (~lines 1993–2234) and are invoked ONLY from the input handler's keystroke
 * dispatch (`startCommitSplit` / `applyCommitSplit` / `cancelCommitSplit`
 * events) — they are NOT referenced in any `useEffect` / `useMemo` dependency
 * array, so there is no identity-stability hazard from co-locating them. A
 * single hook called at their original slot reproduces both the hook-call
 * order and the three `useCallback` identities exactly.
 *
 * The module-level helpers the handlers call
 * (`runCommitSplitPlanWorkflow`, `runCommitSplitApplyWorkflow`,
 * `getWorktreeOverview`, `formatSplitApplySuccess`, the `node:fs` /
 * `node:os` / `node:path` primitives for the diagnostic dump) are imported
 * directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import type { LogInkAction, SplitPlanState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import {
  runCommitSplitApplyWorkflow,
  runCommitSplitPlanWorkflow,
} from '../../../git/commitWorkflowActions'
import { getWorktreeOverview } from '../../../git/statusData'
import { formatSplitApplySuccess } from '../../chrome/postApplyHints'

export type UseCommitSplitActionsDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives the split overlay + status messages. */
  dispatch: (action: LogInkAction) => void
  /**
   * The active frame's context — `context.worktree?.stagedCount` and
   * `context.operation` gate the start of the split.
   */
  context: LogInkContext
  /** `state.splitPlan` — the previewed plan + planContext + fallback. */
  splitPlan: SplitPlanState | undefined
  /** Loud refresh of the full repository context after a split applies. */
  refreshContext: (options?: { silent?: boolean }) => Promise<unknown>
  /** Re-fetch the history rows so the new commits show up in the log view. */
  refreshHistoryRows: () => Promise<unknown>
  /** Re-fetch the worktree context after the split applies. */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
}

export type UseCommitSplitActionsResult = {
  startCommitSplit: () => Promise<void>
  applyCommitSplit: () => Promise<void>
  cancelCommitSplit: () => void
}

export function useCommitSplitActions(
  React: typeof ReactTypes,
  deps: UseCommitSplitActionsDeps,
): UseCommitSplitActionsResult {
  const {
    git,
    dispatch,
    context,
    splitPlan: stateSplitPlan,
    refreshContext,
    refreshHistoryRows,
    refreshWorktreeContext,
  } = deps

  // AbortController for the in-flight plan generation (#1338 pattern —
  // same shape as the changelog / commit-draft cancels). Esc used to be
  // a "soft cancel": the overlay closed but the LLM call ran to
  // completion and its unconditional `setSplitPlanReady` dispatch
  // REOPENED the overlay tens of seconds later, stealing the keyboard
  // from whatever the user had moved on to.
  const planAbortRef = React.useRef<AbortController | null>(null)

  // `S` keystroke — start the `coco commit --split` flow (#907).
  // Pre-flight refuses cleanly when:
  //   - Nothing is staged (suggests `g s` to pick files)
  //   - A bisect / merge / rebase is in progress (split would be confusing)
  // Then opens the overlay in 'loading' state, kicks off the plan
  // workflow, and dispatches setSplitPlanReady (or setSplitPlanError)
  // when it resolves. The overlay handles the rest from there.
  const startCommitSplit = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0
    if (stagedCount === 0) {
      dispatch({
        type: 'setStatus',
        value: 'Nothing staged to split. Stage some files first (`g s` to pick).',
        kind: 'error',
      })
      return
    }
    const operation = context.operation
    if (operation?.operation && operation.operation !== 'none') {
      dispatch({
        type: 'setStatus',
        value: `A ${operation.operation} is in progress — finish or abort it before splitting.`,
        kind: 'error',
      })
      return
    }

    dispatch({ type: 'startSplitPlanLoad' })
    dispatch({ type: 'setStatus', value: 'Generating split plan (this can take a minute)…', loading: true })

    // Abort any predecessor (r re-roll while one is already running)
    // and take ownership of the slot for this invocation.
    planAbortRef.current?.abort()
    const controller = new AbortController()
    planAbortRef.current = controller

    let result: Awaited<ReturnType<typeof runCommitSplitPlanWorkflow>>
    try {
      result = await runCommitSplitPlanWorkflow({ git, signal: controller.signal })
    } catch (error) {
      // #1593: defensive recovery for an unexpected throw escaping the
      // workflow. The workflow catches its own errors today, so this
      // catch is latent — but without it, an escaped throw would become
      // an unhandled rejection and strand the overlay in its loading
      // state forever. Ownership-gated (#1386) like the happy path — a
      // superseding re-roll owns the overlay.
      if (planAbortRef.current === controller) {
        const message = error instanceof Error ? error.message : String(error)
        dispatch({
          type: 'setSplitPlanError',
          error: `Split plan generation failed unexpectedly: ${message}`,
        })
        dispatch({
          type: 'setStatus',
          value: `Split plan generation failed unexpectedly: ${message}`,
          kind: 'error',
        })
      }
      return
    } finally {
      if (planAbortRef.current === controller) {
        planAbortRef.current = null
      }
    }

    // Ownership check: if the user cancelled (Esc → abort) or a newer
    // invocation superseded this one, drop the result on the floor —
    // the cancel path already closed the overlay and set its status.
    if (controller.signal.aborted) {
      return
    }
    if (!result.ok && result.cancelled) {
      return
    }

    if (!result.ok) {
      dispatch({ type: 'setSplitPlanError', error: result.message })
      dispatch({
        type: 'setStatus',
        value: `Split plan failed: ${result.message}`,
        kind: 'error',
      })
      return
    }

    dispatch({
      type: 'setSplitPlanReady',
      plan: result.plan,
      planContext: result.planContext,
      fallback: result.fallback,
      dedupeWarnings: result.dedupeWarnings,
    })
    const readyMessage = result.fallback
      ? `Split planner exhausted retries — showing single-commit fallback. y/Enter to apply as one commit, r to re-roll, Esc to cancel.`
      : `Split plan ready: ${result.plan.groups.length} commit(s). y/Enter to apply, Esc to cancel.`
    // Use 'info' kind for the fallback path (still actionable, just
    // not a clean win). The reducer's "warning" is the absence of
    // `success` framing — the message text itself carries the cue.
    dispatch({
      type: 'setStatus',
      value: readyMessage,
      kind: result.fallback ? 'info' : 'success',
    })
  }, [context.operation, context.worktree?.stagedCount, dispatch, git])

  // `y`/Enter inside the overlay — apply the previewed plan. Uses the
  // plan + planContext from state (set by setSplitPlanReady) so the
  // executed split matches what the user reviewed exactly. No LLM
  // re-roll, no plan drift.
  const applyCommitSplit = React.useCallback(async () => {
    const splitPlan = stateSplitPlan
    if (!splitPlan?.plan || !splitPlan.planContext) {
      dispatch({ type: 'setStatus', value: 'No split plan loaded yet — wait for generation.', kind: 'warning' })
      return
    }

    // Diagnostic dump for the silent-failure bug surfaced in #944
    // manual testing. Writes a per-step record to a file under /tmp so
    // we have ground truth when the workstation's view of the world
    // disagrees with the underlying git state. Path is printed in
    // the post-apply status so the user can paste it back in an
    // issue / PR comment.
    //
    // The dump carries repo metadata (group titles, file paths, recent
    // log, HEAD shas), so on a shared host it must not be world-readable
    // or land at a predictable path. Mirror the editor temp-file hooks:
    // mkdtemp gives an unpredictable, owner-only (0700) directory, and we
    // additionally write the file 0o600 as defense-in-depth. The dir is
    // left in place on purpose — it's diagnostics the user pastes back —
    // and since the path is now random, echoing it leaks nothing guessable.
    let dumpPath: string | undefined
    try {
      const dumpDir = mkdtempSync(nodePath.join(tmpdir(), 'coco-split-'))
      dumpPath = nodePath.join(dumpDir, 'apply.log')
    } catch { /* ignore — diagnostic is best-effort */ }
    const dump: string[] = [
      `[${new Date().toISOString()}] split apply diagnostic dump`,
      `plan: ${splitPlan.plan.groups.length} group(s)`,
      ...splitPlan.plan.groups.map((g, i) =>
        `  group ${i + 1}: ${g.title} — files=[${(g.files || []).join(', ')}] hunks=[${(g.hunks || []).join(', ')}]`
      ),
    ]
    try {
      const headBefore = (await git.revparse(['HEAD'])).trim()
      dump.push(`HEAD before apply: ${headBefore}`)
      const statusBefore = await git.status()
      dump.push(`staged before apply: ${[...statusBefore.staged, ...statusBefore.created, ...statusBefore.renamed].length}`)
      dump.push(`unstaged before apply: ${statusBefore.modified.length + statusBefore.deleted.length}`)
      dump.push(`untracked before apply: ${statusBefore.not_added.length}`)
    } catch (error) {
      dump.push(`pre-apply git probe failed: ${(error as Error).message}`)
    }

    dispatch({ type: 'setSplitPlanApplying' })
    dispatch({ type: 'setStatus', value: 'Applying split plan…', loading: true })

    let result: Awaited<ReturnType<typeof runCommitSplitApplyWorkflow>>
    try {
      result = await runCommitSplitApplyWorkflow({
        plan: splitPlan.plan,
        planContext: splitPlan.planContext,
        git,
        fallback: splitPlan.fallback,
      })
    } catch (error) {
      // #1593: defensive recovery — an unexpected throw from the apply
      // workflow would otherwise escape as an unhandled rejection and
      // strand the overlay in its 'applying' loading state forever.
      const message = error instanceof Error ? error.message : String(error)
      dispatch({ type: 'setSplitPlanError', error: `Split apply failed unexpectedly: ${message}` })
      dispatch({
        type: 'setStatus',
        value: `Split apply failed unexpectedly: ${message}${dumpPath ? ` · diagnostic log: ${dumpPath}` : ''}`,
        kind: 'error',
      })
      return
    }

    dump.push(`workflow returned: ok=${result.ok} message="${result.message}" commitHashes=[${(result.commitHashes || []).join(', ')}]`)

    try {
      const headAfter = (await git.revparse(['HEAD'])).trim()
      dump.push(`HEAD after apply: ${headAfter}`)
      const statusAfter = await git.status()
      dump.push(`staged after apply: ${[...statusAfter.staged, ...statusAfter.created, ...statusAfter.renamed].length}`)
      dump.push(`unstaged after apply: ${statusAfter.modified.length + statusAfter.deleted.length}`)
      dump.push(`untracked after apply: ${statusAfter.not_added.length}`)
      const recentLog = await git.raw(['log', '--oneline', '-n', '10'])
      dump.push(`git log -n 10:`)
      dump.push(...recentLog.split('\n').map((line) => `  ${line}`))
    } catch (error) {
      dump.push(`post-apply git probe failed: ${(error as Error).message}`)
    }

    if (dumpPath) {
      try {
        writeFileSync(dumpPath, dump.join('\n'), { encoding: 'utf8', mode: 0o600 })
      } catch { /* ignore — diagnostic is best-effort */ }
    }
    // Only point the user at the log when we actually have one (mkdtemp
    // could have failed above — the dump is best-effort).
    const dumpNote = dumpPath ? ` · diagnostic log: ${dumpPath}` : ''

    if (!result.ok) {
      // Keep the overlay open so the user can see what happened and
      // try again. setSplitPlanError preserves the existing plan in
      // 'ready' state with the error annotation.
      dispatch({ type: 'setSplitPlanError', error: result.message })
      dispatch({
        type: 'setStatus',
        value: `Split apply failed: ${result.message}${dumpNote}`,
        kind: 'error',
      })
      return
    }

    // Success — close the overlay, reset compose (the staged set is
    // now empty since the plan committed everything), and route the
    // user to the history view so they see the just-landed commits
    // with the recent-commit marker firing on each row that was
    // created. Previous behavior popped compose to whatever was
    // beneath (often status — which now reads "clean worktree" and
    // gives the user no signal that anything just happened);
    // history is the natural follow-on surface.
    //
    // navigateHome nukes the rest of the stack so `<` after apply
    // doesn't walk back into the now-empty compose / status state
    // the user just left behind.
    // Did the plan leave files for the user (the `unclaimed` group the
    // split couldn't confidently place)? They're now sitting unstaged in
    // the worktree, so land on status — not history — so the user sees
    // and handles them, rather than dropping them on a clean-looking
    // history view (#1180).
    const unclaimedGroup = splitPlan.plan.groups.find((group) => group.unclaimed)
    const unclaimedFileCount = unclaimedGroup?.files?.length ?? 0

    dispatch({ type: 'clearSplitPlan' })
    dispatch({ type: 'commitCompose', action: { type: 'reset' } })
    dispatch({ type: 'navigateHome' })
    if (unclaimedFileCount > 0) {
      dispatch({ type: 'pushView', value: 'status' })
    }

    // Refresh BEFORE setting the final status so we can peek at the
    // post-apply worktree state and craft a directive next-step hint
    // ("X unstaged + Y untracked remaining — press gs to stage / I
    // to draft / …"). An empty success message reads as a dead end;
    // a next-step hint keeps momentum.
    //
    // Critical: refreshHistoryRows is the one that re-fetches the
    // commit log. Without this, `gh` would show the pre-apply log —
    // exactly the "spinner runs, no commits visible" silent-failure
    // report from #942 manual testing. The actual commits DO land;
    // `state.rows` just never gets re-fetched after boot.
    await refreshHistoryRows()
    await refreshWorktreeContext()
    await refreshContext()

    // Best-effort peek at the fresh worktree counts. If the second
    // load fails we just fall back to the bare success message — no
    // reason to noisily surface a status-line lookup error after a
    // genuine success.
    const fresh = await getWorktreeOverview(git).catch(() => undefined)
    const unstaged = fresh?.unstagedCount || 0
    const untracked = fresh?.untrackedCount || 0

    // The workflow now returns the actually-created commit hashes
    // directly (verified against HEAD inside applyCommitSplitPlan —
    // each commit confirmed to have advanced the tip). Drive the
    // just-landed marker AND the success-message commit count from
    // that exact data instead of doing a second rev-list round-trip
    // that could disagree with reality on partial-apply.
    const commitHashes = result.commitHashes || []
    if (commitHashes.length > 0) {
      // Audit finding #9: timestamp captured at dispatch time.
      dispatch({ type: 'markRecentCommits', hashes: commitHashes, markedAt: Date.now() })
      // DevSkim: ignore DS172411 — function literal, fixed delay,
      // no caller-supplied data flowing through.
      setTimeout(() => dispatch({ type: 'clearRecentCommits' }), 5000)
    }

    // If the workflow reported success but zero commits actually
    // landed, surface that as an error — the spinner-then-silence
    // failure mode from #940 manual testing where the apply appeared
    // to succeed but the worktree got wiped with no commits made.
    if (commitHashes.length === 0) {
      const detail = result.message || 'No commits were created.'
      dispatch({
        type: 'setStatus',
        value: `Split apply produced zero commits: ${detail}${dumpNote}`,
        kind: 'error',
      })
      return
    }

    const successMessage = formatSplitApplySuccess(
      commitHashes.length,
      unstaged,
      untracked,
      result.fallback ? { reason: result.fallback.reason } : undefined
    )
    // Name the files the split deliberately left behind so the jump to
    // status reads as intentional, not a surprise (#1180).
    const unclaimedNote = unclaimedFileCount > 0
      ? ` · ${unclaimedFileCount} file${unclaimedFileCount === 1 ? '' : 's'} left for you on status`
      : ''
    // Fallback path uses 'info' kind — apply technically succeeded
    // but the user should know it landed as a single combined commit
    // rather than a real LLM-driven multi-group split.
    dispatch({
      type: 'setStatus',
      value: `${successMessage}${unclaimedNote}`,
      kind: result.fallback ? 'info' : 'success',
    })
  }, [dispatch, git, refreshContext, refreshHistoryRows, refreshWorktreeContext, stateSplitPlan])

  // Esc inside the overlay — close without applying, and tear down an
  // in-flight generation (the abort propagates into the LLM HTTP
  // request; the start path's ownership check drops the settled
  // result). Status line gets a confirmation so the user knows the
  // operation was abandoned.
  const cancelCommitSplit = React.useCallback(() => {
    planAbortRef.current?.abort()
    dispatch({ type: 'clearSplitPlan' })
    dispatch({ type: 'setStatus', value: 'Split plan cancelled.' })
  }, [dispatch])

  return {
    startCommitSplit,
    applyCommitSplit,
    cancelCommitSplit,
  }
}
