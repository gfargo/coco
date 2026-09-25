import type { LogInkAction, LogInkState } from './inkViewModel'
import type { LogInkInputEvent } from './inkInput'

/**
 * Returns true when the compose surface holds an unsaved commit message
 * (any text in summary or body and no in-flight AI draft). Used by the
 * quit confirmation flow (P2.3) so users can't lose drafts via a stray
 * `q` / Ctrl+C.
 */
export function hasUnsavedComposeDraft(state: LogInkState): boolean {
  const compose = state.commitCompose
  if (compose.loading) {
    return false
  }
  return Boolean(compose.summary.trim() || compose.body.trim())
}

/**
 * The single quit guard every exit-producing keystroke routes through
 * (Ctrl+C, bare `q`, the help/g? overlay `q`, the split-plan overlay
 * `q`, and the command palette `quit` command — OSS-2795). Ink's own
 * Ctrl+C handler used to bypass all of this when `exitOnCtrlC: true`
 * short-circuited before any `useInput` listener ran; now every path
 * shares this precedence so an unsaved compose draft, an edited rebase
 * plan, or an in-flight split apply can never be lost silently.
 *
 * `pendingConfirmationId` already set is checked first: it's the hard
 * escape hatch — a second Ctrl+C / `q` while a confirm is already open
 * exits unconditionally, so a wedged UI can always be killed.
 */
export function resolveQuitEvents(state: LogInkState): LogInkInputEvent[] {
  if (state.pendingConfirmationId) {
    return [{ type: 'exit' }]
  }
  if (state.splitPlan?.status === 'applying') {
    return [action({ type: 'setPendingConfirmation', value: 'quit-during-split-apply' })]
  }
  if (hasUnsavedComposeDraft(state)) {
    return [action({ type: 'setPendingConfirmation', value: 'discard-draft' })]
  }
  if (state.rebasePlan) {
    return [action({ type: 'setPendingConfirmation', value: 'discard-rebase-plan', payload: 'quit' })]
  }
  return [{ type: 'exit' }]
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
