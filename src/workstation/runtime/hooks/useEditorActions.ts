/**
 * Editor-launch action handlers (extracted in the 0.72 app.ts decomposition,
 * alongside `useCommitComposeActions`).
 *
 * This module lifts the two generic editor `React.useCallback` handlers out of
 * `app.ts`, preserving their original behavior verbatim:
 *
 *   1. `openInEditor` — the generic `$VISUAL` / `$EDITOR` launcher. Drops out
 *      of the alt screen + raw mode, spawns the editor on the given path with
 *      inherited stdio, restores the alt screen + raw mode + hidden cursor,
 *      forces a re-render via `resumeRef`, then silently refreshes the worktree
 *      context (an edit may have changed the staged / unstaged state).
 *   2. `openConfigInEditor` — resolves the global / project coco config path
 *      (falling back to cwd until `repoRootRef` resolves), scaffolds a
 *      templated starter via `ensureConfigFile` when missing, then delegates to
 *      `openInEditor`. It **depends on `openInEditor`** (its dep array is
 *      `[dispatch, openInEditor]`), so the two MUST live in the same hook for
 *      that in-hook identity reference to hold.
 *
 * Each handler body and its `useCallback` dependency array is reproduced
 * byte-for-byte from `app.ts`. The alt-screen / raw-mode terminal dance and the
 * `resumeRef?.current?.()` resume sequencing in `openInEditor` are preserved
 * exactly — a botched resume leaves the user's terminal wedged.
 *
 * Both callbacks are invoked ONLY from the input handler's keystroke dispatch
 * (`openInEditor` / `openConfigInEditor` events) — NOT referenced in any
 * `useEffect` / `useMemo` dependency array — so there is no identity-stability
 * hazard from the move.
 *
 * The module-level helpers (`spawnSync`, `ensureConfigFile`,
 * `resolveConfigPath`) are imported directly here rather than threaded.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { spawnSync } from 'node:child_process'
import type { LogInkAction } from '../inkViewModel'
import { ensureConfigFile, resolveConfigPath, type CocoConfigScope } from '../configFiles'

export type UseEditorActionsDeps = {
  /** Reducer dispatch — drives status messages. */
  dispatch: (action: LogInkAction) => void
  /** Silently re-fetch the worktree context after an edit may have changed it. */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
  /** Forces a re-render after the editor restores the alt screen. */
  resumeRef?: ReactTypes.MutableRefObject<(() => void) | null>
  /** Repo root (async-populated); cwd fallback for config scaffolding. */
  repoRootRef: ReactTypes.MutableRefObject<string | undefined>
}

export type UseEditorActionsResult = {
  openInEditor: (path: string) => void
  openConfigInEditor: (scope: CocoConfigScope) => void
}

export function useEditorActions(
  React: typeof ReactTypes,
  deps: UseEditorActionsDeps,
): UseEditorActionsResult {
  const { dispatch, refreshWorktreeContext, resumeRef, repoRootRef } = deps

  const openInEditor = React.useCallback((path: string) => {
    if (!path) return
    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    // $VISUAL / $EDITOR commonly include flags (`code -w`, `vim -f`,
    // `emacs -nw`). Tokenize on whitespace so the leading word is the
    // executable and the rest are passed as arguments — passing the
    // full string to spawnSync as the executable would fail with
    // ENOENT for any of those configurations.
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'
    const editorPrefixArgs = editorArgs.slice(1)
    const out = process.stdout
    const stdin = process.stdin
    const ENTER_ALT = '\x1b[?1049h'
    const EXIT_ALT = '\x1b[?1049l'
    const SHOW_CURSOR = '\x1b[?25h'
    const HIDE_CURSOR = '\x1b[?25l'
    try {
      // Drop into the primary buffer + cooked mode so the editor
      // doesn't inherit our raw-mode keystrokes.
      stdin.setRawMode?.(false)
      out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
      const result = spawnSync(editor, [...editorPrefixArgs, path], { stdio: 'inherit' })
      if (result.error) {
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
      } else if (result.signal) {
        // Editor was killed by a signal (e.g. ^C, SIGTERM). status is
        // null in this case, so the old `status !== 0` check would
        // mistakenly fall through to the success branch.
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}`, kind: 'warning' })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}`, kind: 'warning' })
      } else {
        dispatch({ type: 'setStatus', value: `Edited ${path}`, kind: 'success' })
      }
    } finally {
      // Re-enter the alt screen + raw mode + hidden cursor; nudge React
      // so the freshly-restored screen actually paints.
      out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
      stdin.setRawMode?.(true)
      resumeRef?.current?.()
    }
    // Worktree status may have changed (e.g. user saved an edit) — silent
    // refresh so the file row reflects the new staged/unstaged state.
    void refreshWorktreeContext({ silent: true })
  }, [dispatch, refreshWorktreeContext, resumeRef])

  // Open the global or project coco config in $EDITOR (gk / gK + their
  // command-palette entries). Scaffolds a templated starter when the file
  // doesn't exist yet so the user never lands in an empty buffer or hits
  // a "no such file" error.
  const openConfigInEditor = React.useCallback((scope: CocoConfigScope) => {
    // `repoRootRef` is populated async from `git rev-parse --show-toplevel`;
    // fall back to cwd so a freshly-launched session can still scaffold +
    // open the project config before that resolves.
    const repoRoot = repoRootRef.current || process.cwd()
    const filePath = resolveConfigPath(scope, repoRoot)
    try {
      const { created } = ensureConfigFile(filePath)
      if (created) {
        dispatch({ type: 'setStatus', value: `Created ${scope} config at ${filePath}`, kind: 'success' })
      }
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Could not create config: ${(error as Error).message}`, kind: 'error' })
      return
    }
    openInEditor(filePath)
  }, [dispatch, openInEditor])

  return {
    openInEditor,
    openConfigInEditor,
  }
}
