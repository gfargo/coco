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
      return {
        ...state,
        editing: action.value,
      }
    case 'setLoading':
      return {
        ...state,
        loading: action.value,
      }
    case 'setDraft':
      return {
        ...state,
        ...splitCommitDraft(action.value),
        field: 'summary',
        editing: true,
        loading: false,
        message: 'AI draft ready for editing',
        details: undefined,
      }
    case 'setResult':
      return {
        ...state,
        loading: false,
        message: action.message,
        details: action.details,
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
