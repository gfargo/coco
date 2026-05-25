import { SimpleGit } from 'simple-git'
import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'

export type CommitComposeField = 'summary' | 'body'

export type CommitComposeState = {
  summary: string
  body: string
  field: CommitComposeField
  editing: boolean
  loading: boolean
  message?: string
  details?: string[]
  /**
   * Live preview of the streamed LLM output while an AI draft is in
   * flight (#881 phase 2). Set by `setStreamingPreview` actions fired
   * from the streaming workflow's `onChunk` callback; cleared by
   * `setDraft` / `setResult` / `reset` so the preview disappears once
   * the final validated draft (or failure) lands.
   *
   * Undefined when no stream is active OR when streaming is disabled
   * by config (`service.streaming.enabled !== true`). The renderer
   * decides what to do with it — current behaviour is to fold the
   * preview into the compose panel below the loading line.
   */
  streamingPreview?: string
  /**
   * AI draft awaiting user confirmation when the compose surface
   * already has user-typed content (audit finding #7). Without this
   * guard, `setDraft` silently overwrote whatever the user had been
   * typing in summary / body, losing their work with no undo. The
   * dispatcher checks for existing content and routes the AI result
   * here instead of straight to `summary` / `body` when the user
   * would be clobbered.
   *
   * The user accepts via `R` (replace) which swaps the draft into the
   * editable fields and clears this state, or dismisses via `Esc`
   * which drops the pending draft and keeps the original typing.
   *
   * Holds the full unparsed draft string (summary + body joined with
   * `\n\n`); `splitCommitDraft` runs at acceptance time so the same
   * helper produces the fields whether the user accepted immediately
   * or after deliberation.
   */
  pendingAiDraft?: string
}

export type CommitComposeAction =
  | { type: 'append'; value: string }
  | { type: 'backspace' }
  | { type: 'clearField' }
  | { type: 'setField'; value: CommitComposeField }
  | { type: 'toggleField' }
  | { type: 'setEditing'; value: boolean }
  | { type: 'setLoading'; value: boolean }
  | { type: 'setDraft'; value: string }
  | { type: 'setResult'; message?: string; details?: string[] }
  | { type: 'setStreamingPreview'; value: string | undefined }
  | { type: 'setPendingAiDraft'; value: string }
  | { type: 'acceptPendingAiDraft' }
  | { type: 'dismissPendingAiDraft' }
  | { type: 'reset' }

export type ManualCommitResult = {
  ok: boolean
  message: string
  details?: string[]
}

export type CreateManualCommitInput = {
  git: SimpleGit
  summary: string
  body?: string
  noVerify?: boolean
}

export function createCommitComposeState(
  input: Partial<CommitComposeState> = {}
): CommitComposeState {
  return {
    summary: '',
    body: '',
    field: 'summary',
    editing: false,
    loading: false,
    message: undefined,
    details: undefined,
    ...input,
  }
}

function activeFieldValue(state: CommitComposeState): string {
  return state.field === 'summary' ? state.summary : state.body
}

function withActiveField(state: CommitComposeState, value: string): CommitComposeState {
  return state.field === 'summary'
    ? { ...state, summary: value }
    : { ...state, body: value }
}

export function applyCommitComposeAction(
  state: CommitComposeState,
  action: CommitComposeAction
): CommitComposeState {
  switch (action.type) {
    case 'append':
      return withActiveField(state, `${activeFieldValue(state)}${action.value}`)
    case 'backspace':
      return withActiveField(state, activeFieldValue(state).slice(0, -1))
    case 'clearField':
      return withActiveField(state, '')
    case 'setField':
      return {
        ...state,
        field: action.value,
      }
    case 'toggleField':
      return {
        ...state,
        field: state.field === 'summary' ? 'body' : 'summary',
      }
    case 'setEditing':
      // Audit finding #12: defensively clear `streamingPreview` when
      // editing toggles off AND no draft is in flight. The current
      // input pipeline never triggers this combination, but the
      // reducer is the source of truth — if a future code path
      // toggles editing off mid-stream, the preview shouldn't linger
      // below an idle compose panel.
      return {
        ...state,
        editing: action.value,
        streamingPreview: !action.value && !state.loading ? undefined : state.streamingPreview,
      }
    case 'setLoading':
      // Clearing loading also clears any in-flight streaming preview;
      // the preview's whole purpose is to fill the wait window. Once
      // the wait ends (success OR failure), the preview is stale.
      return {
        ...state,
        loading: action.value,
        streamingPreview: action.value ? state.streamingPreview : undefined,
      }
    case 'setDraft':
      // Audit finding #7: if the user has typed content in summary or
      // body, the AI draft would silently clobber their work with no
      // undo. Route the result to `pendingAiDraft` instead and surface
      // a confirmation message; the user accepts with `R` (replace)
      // or dismisses with Esc. Empty fields = safe to replace as
      // before, since there's nothing to lose.
      if (state.summary.trim() || state.body.trim()) {
        return {
          ...state,
          loading: false,
          streamingPreview: undefined,
          pendingAiDraft: action.value,
          message:
            'AI draft ready. Press R to replace your text, or Esc to keep what you have.',
          details: undefined,
        }
      }
      // No `message` here — the loader → filled fields are the confirmation
      // that the AI generated something. A lingering "AI draft ready for
      // editing" line in the panel reads as stale state. The runtime still
      // posts the same string to the footer status line for transient
      // feedback.
      return {
        ...state,
        ...splitCommitDraft(action.value),
        field: 'summary',
        editing: true,
        loading: false,
        message: undefined,
        details: undefined,
        streamingPreview: undefined,
        pendingAiDraft: undefined,
      }
    case 'setResult':
      return {
        ...state,
        loading: false,
        message: action.message,
        details: action.details,
        streamingPreview: undefined,
      }
    case 'setStreamingPreview':
      // Per-chunk live-preview update. Fires from the streaming
      // workflow's onChunk callback; the renderer turns it into a
      // last-N-lines panel below the loading line. Pass `undefined`
      // to explicitly clear (the workflow does this on completion
      // alongside the `setDraft` / `setResult` dispatch).
      return {
        ...state,
        streamingPreview: action.value,
      }
    case 'setPendingAiDraft':
      // Audit finding #7: route the AI draft here (instead of straight
      // to summary/body via `setDraft`) when the user has unsaved
      // typing the draft would clobber. The dispatcher does the
      // user-content check; this reducer just stashes the draft and
      // surfaces a message inviting the user to accept or dismiss.
      return {
        ...state,
        loading: false,
        streamingPreview: undefined,
        pendingAiDraft: action.value,
        message: 'AI draft ready. Press R to replace your text, or Esc to keep what you have.',
        details: undefined,
      }
    case 'acceptPendingAiDraft':
      // Swap the pending draft into the editable fields and clear it.
      // Mirrors `setDraft`'s field positioning (focus on summary,
      // editing on) so the user lands in the same place whether they
      // accepted immediately or after deliberation.
      if (!state.pendingAiDraft) return state
      return {
        ...state,
        ...splitCommitDraft(state.pendingAiDraft),
        field: 'summary',
        editing: true,
        loading: false,
        message: undefined,
        details: undefined,
        streamingPreview: undefined,
        pendingAiDraft: undefined,
      }
    case 'dismissPendingAiDraft':
      // User chose to keep their typing; drop the AI draft.
      return {
        ...state,
        pendingAiDraft: undefined,
        message: undefined,
        details: undefined,
      }
    case 'reset':
      // Drop message/details too — the post-commit "Created commit ..."
      // notification is already on the runtime status line (footer); a
      // duplicate copy lingering in the Compose panel reads as stale
      // state once the user starts a fresh draft.
      return createCommitComposeState()
    default:
      return state
  }
}

export function formatCommitComposeMessage(summary: string, body?: string): string {
  const trimmedSummary = summary.trim()
  const trimmedBody = body?.trim()

  return trimmedBody ? `${trimmedSummary}\n\n${trimmedBody}` : trimmedSummary
}

export function splitCommitDraft(draft: string): Pick<CommitComposeState, 'summary' | 'body'> {
  const lines = draft
    .split('\n')
    .map((line) => line.trimEnd())
  const summary = lines.find((line) => line.trim())?.trim() || ''
  const summaryIndex = lines.findIndex((line) => line.trim())
  const body = summaryIndex >= 0
    ? lines.slice(summaryIndex + 1).join('\n').trim()
    : ''

  return {
    summary,
    body,
  }
}

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function formatManualCommitFailure(error: unknown): ManualCommitResult {
  if (error instanceof PreCommitHookError) {
    const details = compactOutputLines(error.hookOutput)

    return {
      ok: false,
      message: `Commit blocked by hook: ${details[0] || 'hook failed'}`,
      details: details.slice(1, 6),
    }
  }

  const details = compactOutputLines((error as Error).message)

  return {
    ok: false,
    message: details[0] || 'Commit failed.',
    details: details.slice(1, 6),
  }
}

export async function createManualCommit({
  git,
  summary,
  body,
  noVerify = false,
}: CreateManualCommitInput): Promise<ManualCommitResult> {
  const message = formatCommitComposeMessage(summary, body)

  if (!message) {
    return {
      ok: false,
      message: 'Commit summary is required.',
    }
  }

  try {
    const result = await createCommit(message, git, undefined, { noVerify })
    const hash = result.commit

    return {
      ok: true,
      message: hash ? `Created commit ${hash}` : 'Created commit.',
    }
  } catch (error) {
    return formatManualCommitFailure(error)
  }
}
