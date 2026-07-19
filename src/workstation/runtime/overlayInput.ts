import { deriveGitignoreOptions } from '../chrome/gitignore'
import { filterLogInkPaletteCommands, getLogInkPaletteCommands } from './inkKeymap'
import { filterThemePresets, getThemePickerSelection } from './themePicker'
import type { LogInkAction, LogInkState } from './inkViewModel'
// `getLogInkPaletteExecuteEvents` is the one runtime (non-type) import back
// into `inkInput.ts`, which itself imports `handleOverlayInput` below — a
// require cycle. It's safe: both bindings are only read inside function
// bodies invoked after module init, never at top-level eval, so load order
// doesn't matter (confirmed by the full suite passing). Not worth breaking
// by extracting the 261-line, multi-helper-dependent palette-execute mapping
// out of `inkInput.ts` for this pass — see OSS-1061 review discussion.
import {
  getLogInkPaletteExecuteEvents,
  type LogInkInputContext,
  type LogInkInputEvent,
  type LogInkInputKey,
} from './inkInput'

/**
 * Modal overlay key handling — theme picker, gitignore picker, command
 * palette, help, and the `g?` view-keys strip — extracted verbatim out of
 * `getLogInkInputEvents`'s monolithic router (OSS-1061 / OSS-950). Each
 * overlay is mutually exclusive and, while open, claims the keyboard ahead
 * of every other handler, so the five blocks are lifted together in their
 * original precedence order (theme -> gitignore -> palette -> help ->
 * view-keys) with no reordering.
 *
 * Returns `null` when no overlay is open, so the caller
 * (`getLogInkInputEvents`) falls through to the rest of the router.
 */
export function handleOverlayInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  // Unused today — kept for parity with the router's (state, inputValue,
  // key, context) contract (matches surfaces/bisect/input.ts); none of
  // these overlays are context-driven.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  context: LogInkInputContext
): LogInkInputEvent[] | null {
  if (state.showThemePicker) {
    const filtered = filterThemePresets(state.themePickerFilter)

    if (key.escape) {
      // Two-stage Esc: clear a non-empty filter first, then close (and
      // revert the live preview to the previously-active theme).
      if (state.themePickerFilter.length > 0) {
        return [action({ type: 'clearThemePickerFilter' })]
      }
      return [action({ type: 'toggleThemePicker' })]
    }

    if (key.return) {
      const selected = getThemePickerSelection(state)
      if (!selected) {
        return [action({ type: 'toggleThemePicker' })]
      }
      return [
        action({ type: 'toggleThemePicker' }),
        { type: 'applyThemePreset', preset: selected },
      ]
    }

    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({ type: 'moveThemePicker', delta: -1, presetCount: filtered.length })]
    }
    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({ type: 'moveThemePicker', delta: 1, presetCount: filtered.length })]
    }
    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceThemePickerFilter' })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearThemePickerFilter' })]
    }
    // All other printable input filters the list (so `j`/`k` type into the
    // filter rather than navigating — matching the command palette).
    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendThemePickerFilter', value: inputValue })]
    }
    return []
  }

  if (state.gitignorePicker) {
    const options = deriveGitignoreOptions(state.gitignorePicker.file)
    if (key.escape) {
      return [action({ type: 'closeGitignorePicker' })]
    }
    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({ type: 'moveGitignorePicker', delta: -1, count: options.length })]
    }
    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({ type: 'moveGitignorePicker', delta: 1, count: options.length })]
    }
    if (key.return) {
      const selected = options[Math.max(0, Math.min(state.gitignorePicker.index, options.length - 1))]
      if (!selected) {
        return [action({ type: 'closeGitignorePicker' })]
      }
      if (selected.custom) {
        // Hand off to a free-text prompt seeded with the file path so
        // the user can type any valid gitignore pattern (negations,
        // globs, anchored paths) the derived options don't cover.
        return [
          action({ type: 'closeGitignorePicker' }),
          action({
            type: 'openInputPrompt',
            kind: 'gitignore-pattern',
            label: `.gitignore pattern (e.g. ${selected.pattern || '*.log'})`,
            initial: selected.pattern,
          }),
        ]
      }
      return [
        action({ type: 'closeGitignorePicker' }),
        { type: 'runWorkflowAction', id: 'add-to-gitignore', payload: selected.pattern },
      ]
    }
    // Consume everything else so the underlying status view keys don't
    // leak through while the picker owns the screen.
    return []
  }

  if (state.showCommandPalette) {
    const filtered = filterLogInkPaletteCommands(
      getLogInkPaletteCommands(),
      state.paletteFilter,
      state.paletteRecent
    )

    if (key.escape) {
      // Two-stage Esc inside the palette: first Esc with non-empty
      // input clears the filter; second Esc closes the palette. P2.4.
      if (state.paletteFilter.length > 0) {
        return [action({ type: 'clearPaletteFilter' })]
      }
      return [action({ type: 'toggleCommandPalette' })]
    }

    if (key.return) {
      const index = Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))
      const selected = filtered[index]
      if (!selected) {
        return [action({ type: 'toggleCommandPalette' })]
      }
      return [
        action({ type: 'recordPaletteRecent', value: selected.id }),
        action({ type: 'toggleCommandPalette' }),
        ...getLogInkPaletteExecuteEvents(selected, state),
      ]
    }

    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({
        type: 'movePaletteSelection',
        delta: -1,
        commandCount: filtered.length,
      })]
    }

    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({
        type: 'movePaletteSelection',
        delta: 1,
        commandCount: filtered.length,
      })]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'backspacePaletteFilter' })]
    }

    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearPaletteFilter' })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendPaletteFilter', value: inputValue })]
    }

    return []
  }

  // Help-overlay key handling. While help is open we intercept ALL
  // keys here and return before they can fall through to scroll /
  // focus / navigation logic below. Without this, j/k while help is
  // open routes into `moveDetailFile`-style handlers, which mutates
  // focus state (`focus: 'detail'` → `'commits'` or `'sidebar'`) —
  // exactly the "scroll loses focus" bug.
  //
  // Allowed: Esc / ? (close), q (quit), j/k/arrows (scroll), Ctrl-d/u
  // (half-page). Everything else is swallowed by the trailing
  // `return []` so a stray keypress can't drop the user into the
  // wrong surface.
  if (state.showHelp) {
    // Type-to-filter (#1355) — `/` opens a text input that narrows the
    // 30+ binding rows. While it owns the keyboard, printable keys
    // append; Enter keeps the filter and returns j/k to scrolling;
    // Esc clears (mirrors the palette's two-stage Esc).
    if (state.helpFilterMode) {
      if (key.escape) {
        return [action({ type: 'clearHelpFilter' })]
      }
      if (key.return) {
        return [action({ type: 'commitHelpFilter' })]
      }
      if (key.backspace || key.delete) {
        return [action({ type: 'backspaceHelpFilter' })]
      }
      if (inputValue && !key.ctrl && !key.meta) {
        return [action({ type: 'appendHelpFilter', value: inputValue })]
      }
      return []
    }
    if (inputValue === '/') {
      return [action({ type: 'openHelpFilter' })]
    }
    if (key.escape || inputValue === '?') {
      // Two-stage Esc: a committed filter clears first, then the
      // overlay closes — same contract as the command palette.
      if (key.escape && state.helpFilter) {
        return [action({ type: 'clearHelpFilter' })]
      }
      return [action({ type: 'toggleHelp' })]
    }
    if (inputValue === 'q') {
      return [{ type: 'exit' }]
    }
    if (key.downArrow || inputValue === 'j') {
      return [action({ type: 'scrollHelp', delta: 1 })]
    }
    if (key.upArrow || inputValue === 'k') {
      return [action({ type: 'scrollHelp', delta: -1 })]
    }
    if (key.ctrl && inputValue === 'd') {
      return [action({ type: 'scrollHelp', delta: 10 })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'scrollHelp', delta: -10 })]
    }
    return []
  }

  // #1137 — the `g?` which-key strip. While it's open the keyboard is
  // claimed (mirrors the help overlay) so a stray keystroke can't drop
  // the user into a per-view action they didn't mean to trigger. Esc
  // closes; `?` is the progressive-disclosure step up to the full
  // categorized help; `q` still quits. Everything else is swallowed —
  // the user peeks, dismisses, then presses the key they came for.
  if (state.showViewKeys) {
    if (key.escape) {
      return [action({ type: 'toggleViewKeys' })]
    }
    if (inputValue === '?') {
      // Expand the compact strip into the full help overlay. `toggleHelp`
      // clears `showViewKeys` so the two never render at once.
      return [action({ type: 'toggleHelp' })]
    }
    if (inputValue === 'q') {
      return [{ type: 'exit' }]
    }
    return []
  }

  return null
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
