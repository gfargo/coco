/**
 * AI conflict resolution actions (#1369) — the runtime half of the `M`
 * workflow.
 *
 * `startConflictResolution` extracts the cursored conflicted file's
 * regions, runs the LLM workflow (abortable via the README's
 * AbortController convention), and lands per-region proposals in
 * `state.conflictResolution`. The per-region flow then goes through
 * `accept` / `edit` / `reject` — proposals are NEVER auto-applied.
 * Accepting the last marker region auto-stages the file via the
 * existing `stageConflictResolved` and refreshes the operation
 * context.
 *
 * All callbacks read live inputs through a render-fresh ref (the
 * `useWorkflowAction` pattern) so the memoized identities never act on
 * stale state.
 */

import type * as ReactTypes from 'react'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import type { SimpleGit } from 'simple-git'
import { runConflictResolutionWorkflow } from '../../../git/conflictAiActions'
import {
  applyConflictResolution,
  getConflictFileRegions,
} from '../../../git/conflictRegionActions'
import { stageConflictResolved } from '../../../git/operationActions'
import type { LogInkAction, LogInkConflictProposal, LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'

export type UseConflictResolutionActionsDeps = {
  git: SimpleGit
  state: LogInkState
  context: LogInkContext
  dispatch: (action: LogInkAction) => void
  /** Shared mount guard — bail out of post-await dispatches after unmount. */
  mountedRef: ReactTypes.MutableRefObject<boolean>
  /** Reload the operation/context slices after a file is fully resolved. */
  refreshContext: (options?: { silent?: boolean }) => Promise<void>
  /** Forces a re-render after the $EDITOR round-trip restores the alt screen. */
  resumeRef?: ReactTypes.MutableRefObject<(() => void) | null>
}

export type UseConflictResolutionActionsResult = {
  startConflictResolution: () => Promise<void>
  cancelConflictResolution: () => void
  acceptConflictProposal: () => Promise<void>
  acceptAllConflictProposals: () => Promise<void>
  editConflictProposal: () => Promise<void>
}

export function useConflictResolutionActions(
  React: typeof ReactTypes,
  deps: UseConflictResolutionActionsDeps,
): UseConflictResolutionActionsResult {
  const depsRef = React.useRef(deps)
  depsRef.current = deps

  // AbortController for the in-flight LLM call — a ref (not state)
  // because Esc reads it synchronously; same lifecycle as
  // `aiDraftAbortRef` in useAiCommitDraftActions.
  const abortRef = React.useRef<AbortController | null>(null)

  const startConflictResolution = React.useCallback(async () => {
    const { git, state, context, dispatch, mountedRef } = depsRef.current
    const files = context.operation?.conflictedFiles || []
    const file = files[Math.max(0, Math.min(state.selectedConflictFileIndex, files.length - 1))]
    if (!file) {
      dispatch({ type: 'setStatus', value: 'No conflicted file selected.', kind: 'warning' })
      return
    }

    const regions = await getConflictFileRegions(git, file.path)
    if (!regions.ok) {
      dispatch({ type: 'setStatus', value: regions.message, kind: 'error' })
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    dispatch({ type: 'setConflictResolutionLoading', path: file.path })
    dispatch({
      type: 'setStatus',
      value: `Proposing resolutions for ${file.path} (${regions.regions.length} region${
        regions.regions.length === 1 ? '' : 's'
      })… esc cancels`,
      loading: true,
    })

    try {
      const result = await runConflictResolutionWorkflow({
        git,
        path: file.path,
        regions: regions.regions,
        operation: context.operation?.operation || 'merge',
        signal: controller.signal,
      })
      if (!mountedRef.current) return

      if (!result.ok) {
        if (result.cancelled) {
          dispatch({ type: 'clearConflictResolution' })
          dispatch({ type: 'setStatus', value: 'Conflict resolution cancelled.', kind: 'info' })
          return
        }
        dispatch({ type: 'setConflictResolutionError', path: file.path, error: result.message })
        dispatch({ type: 'setStatus', value: result.message, kind: 'error' })
        return
      }

      const regionByIndex = new Map(regions.regions.map((region) => [region.index, region]))
      dispatch({
        type: 'setConflictResolutionReady',
        path: file.path,
        proposals: result.proposals.map((proposal) => ({
          regionIndex: proposal.regionIndex,
          resolution: proposal.resolution,
          rationale: proposal.rationale,
          region: regionByIndex.get(proposal.regionIndex)!,
        })),
      })
      dispatch({
        type: 'setStatus',
        value: `${result.message} — y accept · e edit · n reject · Y accept all · esc dismiss`,
        kind: 'success',
      })
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [])

  const cancelConflictResolution = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /**
   * Apply one proposal's resolution to the file. Shared by accept
   * (proposal text as-is) and the $EDITOR edit path (custom text).
   * Returns true when the region was written.
   */
  const applyProposal = React.useCallback(async (
    proposal: LogInkConflictProposal,
    resolution: string,
  ): Promise<boolean> => {
    const { git, dispatch, refreshContext } = depsRef.current
    const session = depsRef.current.state.conflictResolution
    if (!session) return false

    const result = await applyConflictResolution(git, session.path, proposal.region, resolution)
    if (!result.ok) {
      dispatch({ type: 'setStatus', value: result.message, kind: 'error' })
      return false
    }
    dispatch({
      type: 'setConflictProposalStatus',
      regionIndex: proposal.regionIndex,
      status: 'accepted',
      resolution,
    })

    if (result.remainingRegions === 0) {
      // File is marker-free — stage it (the existing mark-resolved
      // action) and close the session.
      const staged = await stageConflictResolved(git, session.path)
      dispatch({ type: 'clearConflictResolution' })
      dispatch({
        type: 'setStatus',
        value: staged.ok
          ? `${session.path} fully resolved and staged`
          : `${session.path} resolved, but staging failed: ${staged.message}`,
        kind: staged.ok ? 'success' : 'error',
      })
      void refreshContext({ silent: true })
    } else {
      dispatch({ type: 'setStatus', value: result.message, kind: 'success' })
    }
    return true
  }, [])

  const acceptConflictProposal = React.useCallback(async () => {
    const session = depsRef.current.state.conflictResolution
    const proposal = session?.proposals[session.selectedIndex]
    if (!session || !proposal || proposal.status !== 'pending') return
    await applyProposal(proposal, proposal.resolution)
  }, [applyProposal])

  const acceptAllConflictProposals = React.useCallback(async () => {
    const session = depsRef.current.state.conflictResolution
    if (!session) return
    const pending = session.proposals.filter((proposal) => proposal.status === 'pending')
    if (pending.length === 0) return
    // Content-matched applies are order-independent, but walking
    // bottom-up keeps the file readable if a mid-run failure stops the
    // loop (earlier regions still carry their markers).
    for (const proposal of [...pending].sort((a, b) => b.regionIndex - a.regionIndex)) {
      const applied = await applyProposal(proposal, proposal.resolution)
      if (!applied) break
      // The session may have been cleared by the final region's apply.
      if (!depsRef.current.state.conflictResolution) break
    }
  }, [applyProposal])

  const editConflictProposal = React.useCallback(async () => {
    const { dispatch, resumeRef } = depsRef.current
    const session = depsRef.current.state.conflictResolution
    const proposal = session?.proposals[session.selectedIndex]
    if (!session || !proposal || proposal.status !== 'pending') return

    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-conflict-edit-'))
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Failed to create temp file: ${(error as Error).message}`, kind: 'error' })
      return
    }
    const ext = nodePath.extname(session.path) || '.txt'
    const file = nodePath.join(dir, `resolution${ext}`)
    try {
      writeFileSync(file, proposal.resolution, 'utf8')

      const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
      const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
      const editor = editorArgs[0] || 'vi'
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
        const result = spawnSync(editor, [...editorArgs.slice(1), file], { stdio: 'inherit' })
        if (result.error) {
          dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
        } else if (result.signal || (typeof result.status === 'number' && result.status !== 0)) {
          dispatch({ type: 'setStatus', value: `${editor} exited without saving — proposal unchanged.`, kind: 'warning' })
        } else {
          editorOk = true
        }
      } finally {
        out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
        stdin.setRawMode?.(true)
        resumeRef?.current?.()
      }

      if (!editorOk) return
      const edited = readFileSync(file, 'utf8')
      await applyProposal(proposal, edited)
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Edit failed: ${(error as Error).message}`, kind: 'error' })
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }, [applyProposal])

  return {
    startConflictResolution,
    cancelConflictResolution,
    acceptConflictProposal,
    acceptAllConflictProposals,
    editConflictProposal,
  }
}
