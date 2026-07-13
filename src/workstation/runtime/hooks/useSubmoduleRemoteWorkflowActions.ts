/**
 * Submodule / remote workflow handlers — the first domain slice extracted
 * out of `useWorkflowAction.ts`'s ~60-entry `handlers` object (#1636).
 *
 * Not a hook, despite the sibling filename convention: every entry in the
 * source `handlers` object is a plain closure rebuilt fresh on each
 * `runWorkflowAction` dispatch (the object literal itself lives inside that
 * callback, never memoized entry-by-entry), and none of these seven are
 * referenced by identity anywhere else. Naming this `useSubmoduleRemote...`
 * would trip `react-hooks/rules-of-hooks` at its call site — it's invoked
 * from inside `runWorkflowAction`'s body, itself nested in a
 * `React.useCallback`, not at `useWorkflowAction`'s top level. A plain
 * factory function reproduces the exact same per-dispatch-fresh-closure
 * behavior with no dependency-array machinery to get wrong.
 *
 * Reproduced verbatim from the original inline entries — same guard
 * messages, same selection resolution via the filtered list (so a
 * filtered-out submodule/remote can never be the target), same `remote-add`
 * payload parsing. The post-handler orchestration (status dispatch,
 * pending-item spinner, context refresh) stays in `useWorkflowAction.ts`
 * and treats these results identically to every other handler's.
 */
import { SimpleGit } from 'simple-git'
import { getSelectedRemote, getSelectedSubmodule } from '../selection'
import type { LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { initSubmodule, syncSubmodule, updateSubmodule } from '../../../git/submoduleActions'
import { addRemote, pruneRemote, removeRemote, setRemoteUrl } from '../../../git/remoteActions'
import type { BranchActionResult } from '../../../git/branchActions'

export type SubmoduleRemoteWorkflowHandlersDeps = {
  git: SimpleGit
  state: LogInkState
  context: LogInkContext
  /** Raw prompt payload — only `remote-add` / `remote-set-url` read it. */
  payload?: string
}

export function createSubmoduleRemoteWorkflowHandlers(
  deps: SubmoduleRemoteWorkflowHandlersDeps
): Record<string, () => Promise<BranchActionResult | undefined>> {
  const { git, state, context, payload } = deps
  return {
    // #0.71 — submodule maintenance. Resolve the target from the filtered
    // list so the cursor index lines up with what's on screen (a
    // filtered-out submodule can never be the action target). The
    // post-handler refreshContext reloads the submodule overview so the
    // row's status flag updates after the action lands.
    'submodule-init': async () => {
      const entry = getSelectedSubmodule(state, context)
      if (!entry) return { ok: false, message: 'No submodule selected' }
      return initSubmodule(git, entry)
    },
    'submodule-update': async () => {
      const entry = getSelectedSubmodule(state, context)
      if (!entry) return { ok: false, message: 'No submodule selected' }
      return updateSubmodule(git, entry, { init: true })
    },
    'submodule-sync': async () => {
      const entry = getSelectedSubmodule(state, context)
      if (!entry) return { ok: false, message: 'No submodule selected' }
      return syncSubmodule(git, entry)
    },
    // #0.71 — remote management. add parses a single `name url` line from
    // the prompt payload; set-url / remove / prune resolve the target from
    // the filtered list so the cursor index lines up with what's on
    // screen. The post-handler refreshContext reloads the remote overview
    // so the list reflects the change.
    'remote-add': async () => {
      const raw = (payload || '').trim()
      if (!raw) return { ok: false, message: 'Remote name and URL required' }
      // Single-line `name url` prompt: first whitespace-run splits the
      // name from the URL. A missing URL falls through to the action's
      // own validation, which returns a friendly error.
      const firstSpace = raw.search(/\s/)
      const name = firstSpace === -1 ? raw : raw.slice(0, firstSpace)
      const url = firstSpace === -1 ? '' : raw.slice(firstSpace).trim()
      return addRemote(git, name, url)
    },
    'remote-set-url': async () => {
      const entry = getSelectedRemote(state, context)
      if (!entry) return { ok: false, message: 'No remote selected' }
      const url = (payload || '').trim()
      return setRemoteUrl(git, entry.name, url)
    },
    'remote-remove': async () => {
      const entry = getSelectedRemote(state, context)
      if (!entry) return { ok: false, message: 'No remote selected' }
      return removeRemote(git, entry.name)
    },
    'remote-prune': async () => {
      const entry = getSelectedRemote(state, context)
      if (!entry) return { ok: false, message: 'No remote selected' }
      return pruneRemote(git, entry.name)
    },
  }
}
