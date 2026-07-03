/**
 * AI-commit-draft action handlers (extracted in the 0.72 app.ts
 * decomposition — the fourth action-callback extraction, after
 * `useWorktreeStageActions`, `useCommitComposeActions`, and
 * `useCommitSplitActions`).
 *
 * This module lifts the two contiguous AI-commit-draft `React.useCallback`
 * handlers out of `app.ts`, in original declaration order, preserving their
 * behavior verbatim:
 *
 *   1. `runAiCommitDraft` — the `I` keystroke. Owns the in-flight
 *      `AbortController` (`aiDraftAbortRef`): tears down any prior
 *      controller, installs a fresh one, runs `runCommitDraftWorkflow({ git,
 *      signal, onStreamChunk })`, streams the accumulated preview into
 *      `commitCompose.streamingPreview` (guarded by `mountedRef` so a torn-
 *      down tree never receives a chunk), then dispatches the draft / result
 *      / cancellation / unexpected-failure paths — each `mountedRef`-guarded.
 *      The `finally` clears the ref only when it still points at OUR
 *      controller, so a rapid second invocation's controller keeps cancel
 *      duty.
 *   2. `cancelAiCommitDraft` — Esc during a loading draft. Idempotent
 *      `aiDraftAbortRef.current?.abort()`; the resulting cleanup dispatches
 *      flow back through `runAiCommitDraft`'s cancel path, not here.
 *
 * The `AbortController` lifecycle (install / abort / own-controller null
 * reset) and the `mountedRef` unmount guards are reproduced exactly — a
 * botched abort or guard would leak an in-flight LLM stream or dispatch into
 * an unmounted tree.
 *
 * `aiDraftAbortRef` is read ONLY by these two callbacks, so it is declared
 * INSIDE the hook (in its original slot — just above `runAiCommitDraft`) and
 * never escapes. `mountedRef` is shared with the rest of the component
 * (mount effect, refresh paths, history loaders) so it STAYS in `app.ts` and
 * is threaded in here.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * byte-for-byte (`[dispatch, git]` and `[]` respectively). Both callbacks are
 * invoked ONLY from the input handler's keystroke dispatch
 * (`runAiCommitDraft` / `cancelAiCommitDraft` events) — NOT referenced in any
 * `useEffect` / `useMemo` dependency array — so there is no identity-stability
 * hazard from co-locating them. A single hook called at their original slot
 * reproduces both the hook-call order and the two `useCallback` identities
 * exactly.
 *
 * The module-level helpers the handlers call (`runCommitDraftWorkflow`,
 * `humanizeAiError`) are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogInkAction } from '../inkViewModel'
import { runCommitDraftWorkflow } from '../../../git/commitWorkflowActions'
import { humanizeAiError } from '../../chrome/aiErrors'

export type UseAiCommitDraftActionsDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives compose streaming + status messages. */
  dispatch: (action: LogInkAction) => void
  /**
   * Shared mount guard — read (not written) here to bail out of any
   * post-await dispatch after the workstation unmounts mid-stream. Owned by
   * `app.ts` (mount effect + other async paths), so it is threaded in.
   */
  mountedRef: ReactTypes.MutableRefObject<boolean>
}

export type UseAiCommitDraftActionsResult = {
  runAiCommitDraft: () => Promise<void>
  cancelAiCommitDraft: () => void
}

export function useAiCommitDraftActions(
  React: typeof ReactTypes,
  deps: UseAiCommitDraftActionsDeps,
): UseAiCommitDraftActionsResult {
  const { git, dispatch, mountedRef } = deps

  // AbortController for the in-flight AI draft (#881 phase 3). Kept in
  // a ref rather than state because cancel is a side-effect: the input
  // handler reads `controllerRef.current?.abort()` synchronously when
  // Esc fires during a loading draft. Storing it in state would force
  // a re-render on every set, and React doesn't need to know — only
  // the imperative cancel path does. Cleared after each call settles
  // so a stale controller can't cancel a future draft.
  const aiDraftAbortRef = React.useRef<AbortController | null>(null)

  const runAiCommitDraft = React.useCallback(async () => {
    // Tear down any controller from a previous draft (defensive — a
    // settled call should have cleared it in the finally block, but
    // double-running would otherwise leave the first orphaned).
    aiDraftAbortRef.current?.abort()
    const controller = new AbortController()
    aiDraftAbortRef.current = controller

    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'generating AI commit draft', loading: true })
    // Streaming preview (#881 phase 2). The workflow forwards this to
    // `generateCommitDraft`, which only actually streams when the
    // user opted in via `service.streaming.enabled`. The callback
    // updates `commitCompose.streamingPreview` so the compose surface
    // renders a live last-N-lines preview below the loader. The
    // reducer clears `streamingPreview` whenever loading flips off
    // (success or failure), so we don't need an explicit teardown
    // dispatch here.
    try {
      const result = await runCommitDraftWorkflow({
        git,
        signal: controller.signal,
        onStreamChunk: (_text, accumulated) => {
          // Audit finding #4: skip dispatching into a torn-down
          // tree. If the user quit (or otherwise unmounted the
          // workstation) mid-stream, React warns about updates on
          // an unmounted component. Drop the chunk silently.
          if (!mountedRef.current) return
          // Superseded (#1386): a newer invocation owns the preview.
          if (aiDraftAbortRef.current !== controller) return
          // Dispatch the full accumulated text — the preview chrome
          // helper does the last-N-lines slicing at render time, so
          // re-doing the slice here would be wasted work. Per-chunk
          // dispatches are cheap; React batches them and Ink redraws
          // at its own frame cadence.
          dispatch({
            type: 'commitCompose',
            action: { type: 'setStreamingPreview', value: accumulated },
          })
        },
      })

      // Audit finding #4 (unmount race): bail out before any
      // post-await dispatch if the user quit while the LLM call was
      // in flight. Same pattern as `refreshHistoryRows` upstream.
      if (!mountedRef.current) return

      // Ownership check (#1386): a rapid re-invocation (Esc then `I`
      // again) aborted this call AFTER dispatching its own loading
      // state — our cancelled/result dispatches would clobber it
      // (spinner + streaming preview vanish while the new LLM call is
      // running). The finally below only clears the ref when it still
      // points at us, so `!==` here always means "superseded".
      if (aiDraftAbortRef.current !== controller) return

      // Cancel path (#881 phase 3). User pressed Esc during the
      // stream; reducer drops loading + preview, status line shows
      // a neutral "cancelled" message. Skip the result / failure
      // dispatches because the user already knows what happened.
      if (result.cancelled) {
        dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: false } })
        dispatch({ type: 'setStatus', value: 'AI draft cancelled.', kind: 'info' })
        return
      }

      if (result.ok && result.draft) {
        dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: result.draft } })
        dispatch({ type: 'setStatus', value: 'AI draft ready for editing', kind: 'success' })
        return
      }

      // Humanize provider errors (rate limit / auth / context / network)
      // into a short actionable line; success-but-no-draft keeps its
      // message as-is.
      const composeMessage = result.ok ? result.message : humanizeAiError(result.message)
      dispatch({
        type: 'commitCompose',
        action: { type: 'setResult', message: composeMessage, details: result.details },
      })
      dispatch({ type: 'setStatus', value: composeMessage, kind: result.ok ? undefined : 'error' })
    } catch (error) {
      // Audit finding #3: defensive recovery for unexpected throws
      // from the workflow. The workflow catches its own errors
      // today, so this catch is latent — but any future refactor
      // that lets an error escape would otherwise strand the
      // spinner permanently with no user-facing recovery short of
      // quitting. Surface a generic failure and clear the loading
      // state so the user can re-try. Ownership-gated (#1386) like the
      // happy path — a superseding invocation owns the loading state.
      if (mountedRef.current && aiDraftAbortRef.current === controller) {
        dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: false } })
        dispatch({
          type: 'setStatus',
          value: `AI draft failed unexpectedly: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        })
      }
    } finally {
      // Clear the ref only if it still points at OUR controller — a
      // rapid second invocation could have already replaced it, in
      // which case the new controller is the one that owns cancel
      // duty now.
      if (aiDraftAbortRef.current === controller) {
        aiDraftAbortRef.current = null
      }
    }
  }, [dispatch, git])

  /**
   * Cancel an in-flight AI draft (#881 phase 3). Called by the input
   * handler when the user presses Esc while `commitCompose.loading`
   * is true. Idempotent — calling without an active controller is a
   * no-op rather than an error so the keystroke handler can fire
   * unconditionally during the loading window.
   *
   * `controller.abort()` propagates through
   * `executeChainStreaming`, which throws `LangChainCancelledError`,
   * which becomes `cancelled: true` on the workflow result. The
   * runAiCommitDraft promise's finally block clears the ref. The
   * resulting cleanup dispatches (clearing loading + status) happen
   * back in `runAiCommitDraft`, not here, so this function stays
   * pure-imperative and the React state updates flow through a
   * single code path.
   */
  const cancelAiCommitDraft = React.useCallback(() => {
    aiDraftAbortRef.current?.abort()
  }, [])

  return {
    runAiCommitDraft,
    cancelAiCommitDraft,
  }
}
