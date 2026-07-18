/**
 * Commit-compose action handlers (extracted in the 0.72 app.ts decomposition,
 * the second action-callback extraction after `useWorktreeStageActions`).
 *
 * This module lifts the two commit-compose `React.useCallback` handlers out of
 * `app.ts`, preserving their original behavior verbatim:
 *
 *   1. `createCommitFromCompose` — guards on `context.worktree?.stagedCount`,
 *      runs `createManualCommit(git, …)` with the in-progress
 *      summary / body, then on success resets the compose state, refreshes
 *      BOTH the history rows and the worktree context, and dispatches
 *      `returnFromCommit` with the still-dirty verdict.
 *   2. `openComposeInEditor` — round-trips the current draft through a temp
 *      `.md` file in `$VISUAL` / `$EDITOR` using the alt-screen / raw-mode
 *      terminal dance, then reads the saved content back into compose state.
 *
 * In `app.ts` these two callbacks are NON-contiguous — separated by ~600 lines
 * of other handlers — but both read only early-declared values (`context`,
 * `state.commitCompose`, `git`, `dispatch`, `refreshHistoryRows`,
 * `refreshWorktreeContext`, `resumeRef`). Co-locating them in a single hook
 * called near the earlier (`createCommitFromCompose`) slot reproduces both
 * `useCallback` identities exactly. They are invoked ONLY from the input
 * handler's keystroke dispatch (`createManualCommit` / `openComposeInEditor`
 * events) — NOT referenced in any `useEffect` / `useMemo` dependency array — so
 * there is no identity-stability hazard from the move.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * verbatim: the only change is that `state.commitCompose` is threaded in as the
 * local `commitCompose` (so the dep array references `commitCompose.summary` /
 * `commitCompose.body` instead of `state.commitCompose.*`), exactly mirroring
 * how `useWorktreeStageActions` renamed `state.worktreeDiffOffset`. The
 * dependency SET — and thus the re-render semantics — is byte-for-byte the
 * same.
 *
 * The module-level helpers the handlers call (`createManualCommit`,
 * `formatCommitComposeMessage`, `spawnSync`, the `node:fs` / `node:os` /
 * `node:path` primitives) are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import type { LogInkAction } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { COMMIT_MOMENTUM_HINT } from '../../chrome/postApplyHints'
import type { CommitComposeState } from '../commitCompose'
import { createManualCommit, formatCommitComposeMessage } from '../commitCompose'
import type { WorktreeOverview } from '../../../git/statusData'

export type UseCommitComposeActionsDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives compose + status messages. */
  dispatch: (action: LogInkAction) => void
  /** The active frame's context — `context.worktree?.stagedCount` gates the commit. */
  context: LogInkContext
  /** `state.commitCompose` — the in-progress summary / body draft. */
  commitCompose: CommitComposeState
  /** Re-fetch the history rows so a new commit shows up in the log view. */
  refreshHistoryRows: () => Promise<unknown>
  /**
   * Re-fetch the worktree context after committing. Returns the fresh
   * overview (or `undefined`) so the post-commit navigation can read the
   * still-dirty counts directly instead of racing the async `setContext`.
   */
  refreshWorktreeContext: (options?: {
    silent?: boolean
  }) => Promise<WorktreeOverview | undefined>
  /** Forces a re-render after the editor restores the alt screen. */
  resumeRef?: ReactTypes.MutableRefObject<(() => void) | null>
}

export type UseCommitComposeActionsResult = {
  createCommitFromCompose: () => Promise<void>
  openComposeInEditor: () => void
}

export function useCommitComposeActions(
  React: typeof ReactTypes,
  deps: UseCommitComposeActionsDeps,
): UseCommitComposeActionsResult {
  const {
    git,
    dispatch,
    context,
    commitCompose,
    refreshHistoryRows,
    refreshWorktreeContext,
    resumeRef,
  } = deps

  const createCommitFromCompose = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0

    if (!stagedCount) {
      dispatch({ type: 'setStatus', value: 'stage changes before committing', kind: 'warning' })
      return
    }

    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'creating commit' })
    const result = await createManualCommit({
      git,
      summary: commitCompose.summary,
      body: commitCompose.body,
    })

    dispatch({
      type: 'commitCompose',
      action: { type: 'setResult', message: result.message, details: result.details },
    })
    // Momentum hint (#1355): a landed commit's natural next moves are
    // push and history — say so at the moment it matters. Outcome-
    // colored per the #1349 convention.
    dispatch({
      type: 'setStatus',
      value: result.ok ? `${result.message}${COMMIT_MOMENTUM_HINT}` : result.message,
      kind: result.ok ? 'success' : 'error',
    })

    if (result.ok) {
      dispatch({ type: 'commitCompose', action: { type: 'reset' } })
      // Refresh BOTH worktree AND history rows — the new commit
      // needs to show up in the history view, not just the staged
      // counts. Without refreshHistoryRows the user would press `gh`
      // and see the pre-commit log (same silent-failure shape as
      // the split-apply case caught in this PR).
      await refreshHistoryRows()
      const worktree = await refreshWorktreeContext()
      // Leave the compose view automatically: a still-dirty tree returns
      // to Status (so the user can keep staging), an otherwise-complete
      // commit returns to History (where the new commit now shows). The
      // reducer inspects the live viewStack to pick the destination.
      const stillDirty = Boolean(
        worktree &&
          worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount > 0,
      )
      dispatch({ type: 'returnFromCommit', stillDirty })
    }
  }, [
    context.worktree?.stagedCount,
    dispatch,
    git,
    refreshHistoryRows,
    refreshWorktreeContext,
    commitCompose.body,
    commitCompose.summary,
  ])

  // `E` keystroke handler — open the current commit draft in $EDITOR
  // (or $VISUAL), then read the file back and update the compose state
  // with the saved content. Mirrors the suspend → spawn → resume
  // terminal dance of `openInEditor` but operates on an in-memory
  // draft (round-tripped through a temp file) rather than a worktree
  // file. Useful when the inline compose editor isn't enough — long
  // bodies, markdown highlighting, paste from elsewhere, etc.
  //
  // Empty drafts are still written to the temp file so the user gets
  // a blank canvas; the read-back uses `setDraft` which splits content
  // into summary + body via `splitCommitDraft`, so the new content
  // re-populates both fields correctly regardless of which one was
  // active before.
  const openComposeInEditor = React.useCallback(() => {
    // Build the current draft text the same way `createManualCommit`
    // would — single string, blank line between summary and body.
    // Round-tripping through this format keeps the parse symmetric:
    // the editor sees what a real commit message would look like, and
    // `splitCommitDraft` on the way back reverses it cleanly.
    const composeState = commitCompose
    const draft = formatCommitComposeMessage(composeState.summary, composeState.body)

    // Temp dir + file. mkdtemp is cleaned up at the end regardless of
    // editor success/failure (`finally` block below). `.md` extension
    // helps editors pick up markdown highlighting — most commit-
    // message workflows treat the body as markdown-ish.
    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-compose-'))
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to create temp file for editor: ${(error as Error).message}`,
        kind: 'error',
      })
      return
    }
    const file = nodePath.join(dir, 'COMMIT_EDITMSG.md')
    try {
      writeFileSync(file, draft, 'utf8')
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

    // Read the (possibly edited) file back and update compose state.
    // We only do this when the editor exited cleanly — a crash / kill
    // shouldn't blow away the user's draft. The setDraft action
    // re-splits into summary + body via splitCommitDraft.
    if (editorOk) {
      try {
        const content = readFileSync(file, 'utf8')
        // `source: 'user'` — the editor content is the user's own typing,
        // so it applies directly instead of staging behind the AI-draft
        // accept prompt.
        dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: content, source: 'user' } })
        dispatch({ type: 'setStatus', value: 'Commit draft updated from editor.', kind: 'success' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited draft: ${(error as Error).message}`,
          kind: 'error',
        })
      }
    }

    // Always clean up the temp dir — even on failure paths above. We
    // don't want abandoned coco-compose-* directories accumulating in
    // /tmp across sessions. Best-effort; ignore errors (e.g. file
    // already removed by the user from inside their editor).
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }, [dispatch, resumeRef, commitCompose])

  return {
    createCommitFromCompose,
    openComposeInEditor,
  }
}
