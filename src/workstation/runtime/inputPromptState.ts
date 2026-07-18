/**
 * Modal text-input prompt state — sliced out of `inkViewModel.ts`'s
 * monolith (#1723), following the `themePicker.ts` pattern: state
 * fragment + action union + a pure `reduce(state, action)`.
 *
 * `'appendInputPrompt'` / `'backspaceInputPrompt'` / `'clearInputPromptText'`
 * deliberately do NOT clear `pendingKey` (unlike `'openInputPrompt'` /
 * `'closeInputPrompt'`) — that asymmetry is preserved by the composition
 * root, which only spreads `pendingKey: undefined` for the open/close
 * cases.
 */
export type LogInkInputPromptKind =
  | 'create-branch'
  | 'create-branch-here'
  | 'create-tag'
  | 'create-tag-here'
  | 'rename-branch'
  | 'set-upstream'
  | 'create-stash'
  | 'rename-stash'
  | 'stash-branch'
  | 'gitignore-pattern'
  | 'stage-pathspec'
  | 'reword-head'
  | 'pr-comment'
  | 'pr-request-changes'
  | 'create-pr'
  | 'bisect-run-command'
  | 'rebase-reword'
  // #0.71 — remotes view mutations. `add-remote` collects a single
  // `name url` line (space-separated, parsed in the submit handler);
  // `set-remote-url` collects just a URL applied to the cursored
  // remote. The prompt itself is the affirmative gate for both, so
  // neither routes through the y-confirm path.
  | 'add-remote'
  | 'set-remote-url'
  // #882 phase 4 — triage-view mutations. Distinct from the
  // single-PR `pr-comment` / `pr-request-changes` kinds above so
  // the submit handler routes to the by-number workflows (the
  // single-PR equivalents target the current branch's PR).
  | 'triage-issue-comment'
  | 'triage-issue-label'
  | 'triage-issue-assign'
  | 'triage-pr-comment'
  | 'triage-pr-label'
  | 'triage-pr-assign'
  // #882 phase 5 — destructive PR mutations on the triage view.
  // Prompts for the review body then forwards through the y-confirm
  // path, routed to the by-number workflow so the cursored PR (not
  // the current branch's) gets the action. (The merge-strategy
  // prompts became 1-key choice prompts in #1351.)
  | 'triage-pr-request-changes'

export type LogInkInputPromptState = {
  kind: LogInkInputPromptKind
  label: string
  value: string
  /**
   * Free-form text mode (#806). When true:
   *   - Enter inserts a literal newline into `value`
   *   - Ctrl+D submits (Unix EOF convention — more reliable across
   *     terminals + Ink than Ctrl+Enter, which most terminals
   *     deliver as plain Enter)
   *   - Backspace, Ctrl+U, Esc behave the same as single-line mode
   * Opt-in per prompt — structured prompts (branch / tag / stash
   * names, merge strategies, reset modes) stay single-line so muscle
   * memory survives.
   */
  multiline?: boolean
}

export type InputPromptFields = {
  inputPrompt?: LogInkInputPromptState
}

export type InputPromptAction =
  | { type: 'openInputPrompt'; kind: LogInkInputPromptKind; label: string; initial?: string; multiline?: boolean }
  | { type: 'appendInputPrompt'; value: string }
  | { type: 'backspaceInputPrompt' }
  | { type: 'clearInputPromptText' }
  | { type: 'closeInputPrompt' }

export function applyInputPromptAction(
  state: InputPromptFields,
  action: InputPromptAction
): InputPromptFields {
  switch (action.type) {
    case 'openInputPrompt':
      return {
        ...state,
        inputPrompt: {
          kind: action.kind,
          label: action.label,
          value: action.initial || '',
          multiline: action.multiline,
        },
      }
    case 'appendInputPrompt':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: `${state.inputPrompt.value}${action.value}` } }
        : state
    case 'backspaceInputPrompt':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: state.inputPrompt.value.slice(0, -1) } }
        : state
    case 'clearInputPromptText':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: '' } }
        : state
    case 'closeInputPrompt':
      return { ...state, inputPrompt: undefined }
    default:
      return state
  }
}
