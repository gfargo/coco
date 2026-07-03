/**
 * Changelog action handlers (extracted in the 0.72 app.ts decomposition,
 * alongside `useYankActions`).
 *
 * This module lifts the four changelog `React.useCallback` handlers out of
 * `app.ts`, in original declaration order, preserving their behavior verbatim:
 *
 *   1. `startChangelogView` — the `L` keystroke. Resolves the head / default
 *      branch, checks `state.changelogCache` (keyed by branch), and either
 *      replays the cached entry or pushes the `changelog` view in a loading
 *      state and runs `runChangelogTextWorkflow(argv)`, dispatching the
 *      ready / error paths. Dep array
 *      `[context.branches?.currentBranch, context.provider?.currentBranch,
 *      context.provider?.repository.defaultBranch, dispatch, changelogCache]`.
 *   2. `regenerateChangelog` — the `r` keystroke inside the view. A thin
 *      wrapper that calls the in-hook `startChangelogView({ force: true })`;
 *      it references that in-hook identity, keeping its `[startChangelogView]`
 *      dep array verbatim.
 *   3. `yankChangelog` — the `y` keystroke inside the view. Reads the current
 *      `state.changelogView.text` and delegates to `yankText` — which lives in
 *      the sibling `useYankActions` hook and is therefore **threaded in as a
 *      dep**. Dep array `[dispatch, changelogViewText, yankText]`.
 *   4. `openChangelogInEditor` — the `E` keystroke inside the view. Round-trips
 *      the current text through a temp `.md` file in `$VISUAL` / `$EDITOR`
 *      using the alt-screen / raw-mode terminal dance, then reads the saved
 *      content back via `setChangelogText`. The editor spawn / temp-file /
 *      resume sequencing is preserved exactly. Dep array
 *      `[dispatch, resumeRef, changelogViewText]`.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * byte-for-byte. The only mechanical change is that the state slices the dep
 * arrays reference (`state.changelogCache`, `state.changelogView.text`) are
 * threaded in as locals (`changelogCache`, `changelogViewText`) — the
 * dependency SET, and thus the re-render semantics, is identical. All four
 * callbacks are invoked ONLY from the input handler's keystroke dispatch
 * (`startChangelogView` / `regenerateChangelog` / `yankChangelog` /
 * `openChangelogInEditor` events) — NOT referenced in any `useEffect` /
 * `useMemo` dependency array — so there is no identity-stability hazard from
 * the move.
 *
 * `regenerateChangelog` references the in-hook `startChangelogView`; `yankText`
 * is owned by `useYankActions` (called first, before this hook) and threaded
 * in. The module-level helper `runChangelogTextWorkflow` and the
 * `node:fs` / `node:os` / `node:path` / `node:child_process` primitives the
 * editor spawn uses are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import type { LogInkAction, LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { runChangelogTextWorkflow } from '../../../git/aiActions'

export type UseChangelogActionsDeps = {
  /** Reducer dispatch — drives the changelog view + status messages. */
  dispatch: (action: LogInkAction) => void
  /** The active frame's context — branch / provider info for the base resolution. */
  context: LogInkContext
  /** Per-branch changelog cache (keyed by branch name). */
  changelogCache: LogInkState['changelogCache']
  /** The changelog view's current text slice (yank + editor source). */
  changelogViewText: LogInkState['changelogView']['text']
  /** Forces a re-render after the editor restores the alt screen. */
  resumeRef?: ReactTypes.MutableRefObject<(() => void) | null>
  /**
   * Generic clipboard yank — owned by `useYankActions` (called before this
   * hook) and threaded in so `yankChangelog` can delegate to it while keeping
   * its `[dispatch, changelogViewText, yankText]` dep array verbatim.
   */
  yankText: (value: string, label: string) => Promise<void>
}

export type UseChangelogActionsResult = {
  startChangelogView: (options?: { force?: boolean }) => Promise<void>
  regenerateChangelog: () => void
  yankChangelog: () => void
  openChangelogInEditor: () => void
  /** Esc during a loading changelog — aborts the in-flight LLM call (#1338). */
  cancelChangelog: () => void
}

export function useChangelogActions(
  React: typeof ReactTypes,
  deps: UseChangelogActionsDeps,
): UseChangelogActionsResult {
  const {
    dispatch,
    context,
    changelogCache,
    changelogViewText,
    resumeRef,
    yankText,
  } = deps

  // `L` keystroke handler — generate (or recall from cache) a changelog
  // for the current branch and push the dedicated `changelog` surface
  // to display it. The view renders the full text in the main panel
  // (not cramped into an input prompt), with its own keymap for scroll,
  // yank, $EDITOR, create-PR, and regenerate.
  //
  // Caching: `state.changelogCache` is keyed by branch name. On `L`,
  // we check the cache first and reuse if hit (no LLM call); the user
  // presses `r` from inside the view to force a regenerate. Switching
  // branches naturally produces a fresh generation since the cache key
  // changes.
  //
  // Surface lifecycle: we push the `changelog` view BEFORE awaiting the
  // workflow, so the user sees a loading state instead of a blank
  // history view while the LLM runs. On error, we keep the view pushed
  // and render the error there (with `r` to retry) instead of bailing
  // back to history with a status-line message that may scroll past.
  // AbortController for the in-flight changelog generation (#1338).
  // Same lifecycle as `aiDraftAbortRef` in useAiCommitDraftActions: a
  // ref (not state) because cancel is a synchronous side-effect read by
  // the input handler's Esc binding; installed per invocation, cleared
  // in the finally block only when it still points at OUR controller.
  const changelogAbortRef = React.useRef<AbortController | null>(null)

  const startChangelogView = React.useCallback(async (options: { force?: boolean } = {}) => {
    const head = context.branches?.currentBranch || context.provider?.currentBranch
    if (!head) {
      dispatch({ type: 'setStatus', value: 'No current branch — check out a branch first.', kind: 'warning' })
      return
    }
    const defaultBranch = context.provider?.repository.defaultBranch
    // The changelog command will fall back to its own defaults when no
    // branch arg is passed, but being explicit about the base is more
    // honest about what the user is seeing. With the local default-
    // branch fallback in providerData (#912), `defaultBranch` is
    // populated even for non-GitHub / offline scenarios — we only fall
    // through to `--since-last-tag` when truly nothing resolves.
    const argv = defaultBranch && head !== defaultBranch
      ? { branch: defaultBranch }
      : { sinceLastTag: true }
    const baseLabel = defaultBranch && head !== defaultBranch
      ? `vs ${defaultBranch}`
      : 'since last tag'

    // Cache hit — skip the LLM, push view with ready content. The
    // generated-at timestamp on the cache entry drives the "(cached, N
    // ago)" hint in the header, so the user knows whether to press `r`.
    const cached = !options.force ? changelogCache[head] : undefined
    if (cached) {
      dispatch({ type: 'pushView', value: 'changelog' })
      dispatch({
        type: 'setChangelogReady',
        branch: head,
        baseLabel: cached.baseLabel,
        text: cached.text,
        // Audit finding #9: cache-hit path preserves the original
        // generation timestamp rather than minting a fresh one — the
        // "X ago" header should reflect when the LLM ran, not when
        // the cached entry was re-displayed.
        generatedAt: cached.generatedAt,
      })
      dispatch({
        type: 'setStatus',
        value: `Changelog loaded from cache (${cached.baseLabel}). r to regenerate.`,
      })
      return
    }

    // No cache (or force=true via `r`) — push view with loading state,
    // then run the workflow.
    dispatch({ type: 'pushView', value: 'changelog' })
    dispatch({ type: 'setChangelogLoading', branch: head, baseLabel })
    dispatch({ type: 'setStatus', value: `generating changelog (${baseLabel})…`, loading: true })

    // Tear down any controller from a previous generation (defensive —
    // a settled call clears it in the finally block below) and install
    // a fresh one so Esc can abort THIS call (#1338).
    changelogAbortRef.current?.abort()
    const controller = new AbortController()
    changelogAbortRef.current = controller

    try {
      const result = await runChangelogTextWorkflow(argv, { signal: controller.signal })

      // Cancel path (#1338): the user pressed Esc mid-generation. Move
      // the view out of its loading state (r regenerates) and show a
      // neutral — not error — status line.
      if (result.cancelled) {
        dispatch({
          type: 'setChangelogError',
          branch: head,
          baseLabel,
          error: 'Cancelled — press r to regenerate.',
        })
        dispatch({ type: 'setStatus', value: 'Changelog generation cancelled.', kind: 'info' })
        return
      }

      if (!result.ok || !result.text) {
        dispatch({
          type: 'setChangelogError',
          branch: head,
          baseLabel,
          error: result.message,
        })
        dispatch({ type: 'setStatus', value: `Changelog failed: ${result.message}`, kind: 'error' })
        return
      }

      dispatch({
        type: 'setChangelogReady',
        branch: head,
        baseLabel,
        text: result.text,
        // Audit finding #9: timestamp captured at dispatch time, not
        // inside the reducer.
        generatedAt: Date.now(),
      })
      dispatch({
        type: 'setStatus',
        value: 'Changelog ready — y yank · E $EDITOR · c PR · r regen · < back.',
        kind: 'success',
      })
    } finally {
      // Clear the ref only if it still points at OUR controller — a
      // rapid regenerate could have already replaced it, in which case
      // the new controller owns cancel duty now.
      if (changelogAbortRef.current === controller) {
        changelogAbortRef.current = null
      }
    }
  }, [
    context.branches?.currentBranch,
    context.provider?.currentBranch,
    context.provider?.repository.defaultBranch,
    dispatch,
    changelogCache,
  ])

  // `r` keystroke inside the changelog view — re-run generation
  // ignoring any cached result. Thin wrapper since the underlying
  // logic in `startChangelogView` already supports the force path.
  const regenerateChangelog = React.useCallback(() => {
    void startChangelogView({ force: true })
  }, [startChangelogView])

  // `y` keystroke inside the changelog view — yank the current text
  // to the system clipboard. Pulled from view state rather than from
  // wherever the cursor is (no per-row selection on this surface).
  const yankChangelog = React.useCallback(() => {
    const text = changelogViewText
    if (!text) {
      dispatch({ type: 'setStatus', value: 'No changelog text to copy.', kind: 'warning' })
      return
    }
    void yankText(text, 'changelog')
  }, [dispatch, changelogViewText, yankText])

  // `E` keystroke inside the changelog view — open the current text in
  // $EDITOR / $VISUAL, read it back, update view + cache. Mirrors the
  // compose `E` flow (#913) but on the changelog-view state slice.
  // After save, `setChangelogText` updates both view and cache so the
  // edits persist across view re-entry.
  const openChangelogInEditor = React.useCallback(() => {
    const current = changelogViewText
    if (current === undefined) {
      dispatch({ type: 'setStatus', value: 'Changelog not loaded yet — wait for generation.', kind: 'warning' })
      return
    }

    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-changelog-'))
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to create temp file for editor: ${(error as Error).message}`,
        kind: 'error',
      })
      return
    }
    const file = nodePath.join(dir, 'CHANGELOG.md')
    try {
      writeFileSync(file, current, 'utf8')
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to seed temp file: ${(error as Error).message}`,
        kind: 'error',
      })
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      return
    }

    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'
    const editorPrefixArgs = editorArgs.slice(1)
    const out = process.stdout
    const stdin = process.stdin
    const ENTER_ALT = '\x1b[?1049h'
    const EXIT_ALT = '\x1b[?1049l'
    const SHOW_CURSOR = '\x1b[?25h'
    const HIDE_CURSOR = '\x1b[?25l'

    let editorOk = false
    try {
      stdin.setRawMode?.(false)
      out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
      const result = spawnSync(editor, [...editorPrefixArgs, file], { stdio: 'inherit' })
      if (result.error) {
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
      } else if (result.signal) {
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}`, kind: 'warning' })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}`, kind: 'warning' })
      } else {
        editorOk = true
      }
    } finally {
      out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
      stdin.setRawMode?.(true)
      resumeRef?.current?.()
    }

    if (editorOk) {
      try {
        const content = readFileSync(file, 'utf8')
        dispatch({ type: 'setChangelogText', text: content, generatedAt: Date.now() })
        dispatch({ type: 'setStatus', value: 'Changelog updated from editor.', kind: 'success' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited changelog: ${(error as Error).message}`,
          kind: 'error',
        })
      }
    }

    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }, [dispatch, resumeRef, changelogViewText])

  /**
   * Cancel an in-flight changelog generation (#1338). Called by the
   * input handler when Esc fires while `changelogView.status ===
   * 'loading'`. Idempotent — no active controller is a no-op. The
   * cleanup dispatches (view transition + status) flow back through
   * `startChangelogView`'s cancelled path, not here.
   */
  const cancelChangelog = React.useCallback(() => {
    changelogAbortRef.current?.abort()
  }, [])

  return {
    startChangelogView,
    regenerateChangelog,
    yankChangelog,
    openChangelogInEditor,
    cancelChangelog,
  }
}
