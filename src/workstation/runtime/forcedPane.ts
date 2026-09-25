import type { LogInkVisiblePane } from '../chrome/layout'
import type { LogInkState } from './inkViewModel'

type ForcedPaneState = Pick<
  LogInkState,
  | 'splitPlan'
  | 'showHelp'
  | 'showViewKeys'
  | 'showCommandPalette'
  | 'showThemePicker'
  | 'gitignorePicker'
  | 'inputPrompt'
  | 'pendingConfirmationId'
  | 'pendingChoice'
  | 'pendingKey'
>

/**
 * In single-pane mode (narrow terminals) only one pane renders, so an
 * active overlay must pull its own pane into view rather than stay
 * hidden behind whatever pane focus points at.
 *
 * The confirmation / choice / help / palette / theme / gitignore /
 * input-prompt / chord overlays all render in the inspector, so they
 * take precedence over the split-plan overlay (which lives in the
 * main panel) — a pending confirmation must stay visible even while a
 * split apply is in flight (OSS-2795: `quit-during-split-apply` was
 * otherwise raised behind a `forcedPane: 'main'` that never yielded to
 * it, leaving `q` looking like it froze the UI on narrow terminals).
 */
export function resolveForcedPane(state: ForcedPaneState): LogInkVisiblePane | undefined {
  if (
    state.showHelp ||
    state.showViewKeys ||
    state.showCommandPalette ||
    state.showThemePicker ||
    state.gitignorePicker ||
    state.inputPrompt ||
    state.pendingConfirmationId ||
    state.pendingChoice ||
    state.pendingKey
  ) {
    return 'inspector'
  }
  if (state.splitPlan) {
    return 'main'
  }
  return undefined
}
