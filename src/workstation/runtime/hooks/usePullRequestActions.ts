/**
 * Pull-request action handlers (extracted in the 0.72 app.ts decomposition —
 * the fifth action-callback extraction, after `useWorktreeStageActions`,
 * `useCommitComposeActions`, `useCommitSplitActions`, and
 * `useAiCommitDraftActions`).
 *
 * This module lifts the two contiguous pull-request `React.useCallback`
 * handlers out of `app.ts`, in original declaration order, preserving their
 * behavior verbatim:
 *
 *   1. `startCreatePullRequest` — the `C` keystroke. Pre-flight validates the
 *      head / base branches, the provider, and that no PR is already open;
 *      installs the soft-cancel handle (`pullRequestBodyCancelRef.current = {
 *      cancelled: false }`) BEFORE flipping the pending flag so a synchronous
 *      Esc can't race the flag-set; runs `runPullRequestBodyWorkflow({
 *      baseBranch })`; on resolve checks the soft-cancel flag, then dispatches
 *      `setPendingPullRequestBodyDraft(false)` and `openInputPrompt` (or a
 *      neutral cancel status). The `finally` re-clears the pending flag and
 *      nulls the ref only when it still owns the handle.
 *   2. `cancelPullRequestBodyDraft` — Esc during the draft. Soft-cancel:
 *      mutates `.cancelled = true` on the live handle (no-op when null); the
 *      workflow checks it after its await resolves and skips the prompt-open.
 *      The LLM call itself isn't aborted.
 *
 * The soft-cancel handle init + mutation sequencing is reproduced exactly — a
 * botched handle would either open a prompt the user cancelled or strand the
 * pending flag.
 *
 * `pullRequestBodyCancelRef` is read ONLY by these two callbacks, so it is
 * declared INSIDE the hook (in its original slot — just above
 * `startCreatePullRequest`) and never escapes.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * byte-for-byte. Both callbacks are invoked ONLY from the input handler's
 * keystroke dispatch (`startCreatePullRequest` / `cancelPullRequestBodyDraft`
 * events) — NOT referenced in any `useEffect` / `useMemo` dependency array —
 * so there is no identity-stability hazard from co-locating them. A single
 * hook called at their original slot reproduces both the hook-call order and
 * the two `useCallback` identities exactly.
 *
 * The module-level helpers the handlers call (`runPullRequestBodyWorkflow`,
 * `forgeNouns`) are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { GitProviderType } from '../../../git/providerData'
import type { LogInkAction } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { runPullRequestBodyWorkflow } from '../../../git/aiActions'
import { forgeNouns } from '../../chrome/forgeNouns'

export type UsePullRequestActionsDeps = {
  /** Reducer dispatch — drives the pending flag, status, and input prompt. */
  dispatch: (action: LogInkAction) => void
  /**
   * The active frame's context — the dep array reads
   * `context.branches?.currentBranch`, `context.provider?.currentBranch`,
   * `context.provider?.currentPullRequest`,
   * `context.provider?.repository.defaultBranch`, and
   * `context.pullRequest?.currentPullRequest` for the pre-flight.
   */
  context: LogInkContext
  /** The resolved forge provider — drives noun copy (PR vs MR). */
  forgeProvider: GitProviderType | undefined
}

export type UsePullRequestActionsResult = {
  startCreatePullRequest: () => Promise<void>
  cancelPullRequestBodyDraft: () => void
}

export function usePullRequestActions(
  React: typeof ReactTypes,
  deps: UsePullRequestActionsDeps,
): UsePullRequestActionsResult {
  const { dispatch, context, forgeProvider } = deps

  // `C` keystroke handler — start the create-pull-request flow. Resolves
  // the head + base branches from the live context, runs
  // `coco changelog --branch <base>` (via `runPullRequestBodyWorkflow`)
  // to seed a title + body, then opens a multi-line input prompt
  // pre-filled with that content for the user to edit before submission.
  //
  // On submit, the workflow handler `'create-pr'` parses the prompt
  // value (line 1 = title, lines 2+ = body) and runs
  // `createPullRequest({ base, head, title, body })`. If anything in the
  // pre-flight goes sideways (no current branch, no provider, gh CLI
  // missing) we surface the failure on the status line and skip the
  // prompt entirely — better than opening a prompt the user can't
  // actually submit successfully.
  // Soft-cancel handle for the PR body draft (#881 phase 4). A mutable
  // ref rather than state because the cancel decision needs to be
  // visible synchronously inside the async workflow without forcing
  // re-renders. Owned by the in-flight invocation: the cancel callback
  // mutates `.cancelled` on the live ref; the workflow checks it after
  // `await` resolves and decides whether to open the follow-up prompt.
  //
  // The LLM call itself keeps running (no AbortSignal threaded through
  // `changelogHandler` today). The user-visible outcome — "PR draft
  // cancelled, no prompt opens" — is identical to a hard cancel, at
  // the cost of paying for the in-flight tokens. Deeper threading
  // lands in a follow-up if hard cancel becomes a request.
  const pullRequestBodyCancelRef = React.useRef<{ cancelled: boolean } | null>(null)
  const startCreatePullRequest = React.useCallback(async () => {
    const nouns = forgeNouns(forgeProvider)
    const head = context.branches?.currentBranch || context.provider?.currentBranch
    if (!head) {
      dispatch({ type: 'setStatus', value: `No current branch to create a ${nouns.abbrev} from.`, kind: 'warning' })
      return
    }
    const defaultBranch = context.provider?.repository.defaultBranch
    if (!defaultBranch) {
      dispatch({
        type: 'setStatus',
        value: 'No default branch detected. Set origin/HEAD or ensure main/master exists locally.',
        kind: 'warning',
      })
      return
    }
    if (head === defaultBranch) {
      dispatch({ type: 'setStatus', value: `Current branch is ${defaultBranch}; check out a feature branch first.`, kind: 'warning' })
      return
    }
    if (context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest) {
      const existing = context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest
      dispatch({
        type: 'setStatus',
        value: existing
          ? `${nouns.abbrev} #${existing.number} already open for ${head}. Use the ${nouns.abbrev} view to manage it.`
          : `A ${nouns.singularLower} is already open for ${head}.`,
        kind: 'warning',
      })
      return
    }

    // Set up the cancel handle BEFORE flipping the pending flag so a
    // race between the flag-set and a synchronous Esc keystroke can't
    // leave the input handler dispatching cancel without a ref to
    // mutate. The cancel callback no-ops cleanly when the ref is null
    // (call already settled).
    const cancelHandle = { cancelled: false }
    pullRequestBodyCancelRef.current = cancelHandle

    dispatch({ type: 'setPendingPullRequestBodyDraft', value: true })
    // Audit finding #6: soft cancel today — Esc skips opening the
    // follow-up prompt, but the LLM call itself keeps running to
    // completion (no AbortSignal threaded through the changelog CLI
    // chain). Status copy reflects that honestly so the user isn't
    // misled into thinking they're saving tokens.
    dispatch({
      type: 'setStatus',
      value: `generating ${nouns.abbrev} body from changelog (vs ${defaultBranch}) — Esc to skip prompt`,
      loading: true,
    })

    try {
      const body = await runPullRequestBodyWorkflow({ baseBranch: defaultBranch })

      // Soft-cancel check (#881 phase 4). If the user pressed Esc
      // while the workflow was awaiting, skip opening the prompt and
      // surface a neutral status. The underlying LLM call has
      // already settled — its result is discarded. Hard cancel
      // (aborting the HTTP request mid-flight) is a follow-up.
      if (cancelHandle.cancelled) {
        dispatch({ type: 'setStatus', value: `${nouns.abbrev} draft cancelled.` })
        return
      }

      // Fallback shape when the changelog generation fails — open the
      // prompt with empty title + body rather than aborting, so the user
      // can still author the PR manually. The status line surfaces why
      // we couldn't pre-fill.
      const initialTitle = body.title || head.replace(/^(feat|fix|chore|docs|refactor|test)\//, '').replace(/[-_]/g, ' ')
      const initialBody = body.body || ''
      const initial = initialBody ? `${initialTitle}\n\n${initialBody}` : initialTitle

      if (!body.ok) {
        dispatch({ type: 'setStatus', value: `${nouns.abbrev} body generation failed: ${body.message}. Edit manually.`, kind: 'error' })
      } else {
        dispatch({ type: 'setStatus', value: `${nouns.abbrev} body drafted — review and Ctrl+D to submit.`, kind: 'success' })
      }

      // Audit finding #11: clear the pending flag BEFORE opening the
      // prompt. If a future refactor adds an `await` between the flag
      // clear (currently in `finally`) and the `openInputPrompt`
      // dispatch, an Esc keystroke in the gap would dispatch
      // `cancelPullRequestBodyDraft` AFTER the prompt opens, leaving
      // the prompt visible with a stale "cancelled" message. Clearing
      // here moves the flag teardown into the same React batch as the
      // prompt open, eliminating the race.
      dispatch({ type: 'setPendingPullRequestBodyDraft', value: false })

      dispatch({
        type: 'openInputPrompt',
        kind: 'create-pr',
        label: `Create ${nouns.abbrev}: ${head} → ${defaultBranch}  (line 1 title · rest body · Enter newline · Ctrl+D submit)`,
        initial,
        multiline: true,
      })
    } finally {
      // Belt-and-suspenders: the `try` block clears the flag on the
      // success path (audit finding #11). This duplicate clear handles
      // the error / cancel paths where the early-returns skip the
      // success-path dispatch. Safe to no-op when already false.
      dispatch({ type: 'setPendingPullRequestBodyDraft', value: false })
      // Only clear the ref if we still own it — a second invocation
      // would have already taken ownership in which case the cancel
      // duty has rolled over.
      if (pullRequestBodyCancelRef.current === cancelHandle) {
        pullRequestBodyCancelRef.current = null
      }
    }
  }, [
    context.branches?.currentBranch,
    context.provider?.currentBranch,
    context.provider?.currentPullRequest,
    context.provider?.repository.defaultBranch,
    context.pullRequest?.currentPullRequest,
    forgeProvider,
    dispatch,
  ])

  /**
   * Soft-cancel the in-flight PR body draft (#881 phase 4). The
   * cancel ref's `.cancelled` flag is checked after the workflow's
   * await resolves; setting it true causes the workflow to skip the
   * prompt-open and surface a neutral "cancelled" status. The LLM
   * call itself isn't aborted (no signal threaded through the
   * `changelogHandler` chain) so the user still pays for the in-flight
   * tokens. Acceptable for a 5-15s draft; hard cancel lands in a
   * follow-up if it becomes a real ask.
   *
   * Idempotent — calling without an active draft is a no-op.
   */
  const cancelPullRequestBodyDraft = React.useCallback(() => {
    const handle = pullRequestBodyCancelRef.current
    if (!handle) return
    handle.cancelled = true
  }, [])

  return {
    startCreatePullRequest,
    cancelPullRequestBodyDraft,
  }
}
