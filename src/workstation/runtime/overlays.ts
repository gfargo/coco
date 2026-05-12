/**
 * Overlay renderers — panels that appear in place of the detail pane
 * when transient UI state is active. Their precedence is encoded in
 * `renderDetailPanel`'s dispatcher (most-recent first):
 *
 *   1. help          (`?`)
 *   2. command palette (`:`)
 *   3. input prompt   (any workflow that needs user text)
 *   4. confirmation   (destructive action gating, AI cost gating)
 *   5. chord overlay  (which-key style — after the prefix is pressed)
 *
 * Plus a sixth overlay that takes over the whole layout for first-run:
 *   - onboarding overlay (P1.3, gated by `hasSeenOnboarding`).
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import {
  filterLogInkPaletteCommands,
  formatBindingKeys,
  getLogInkChordContinuations,
  getLogInkHelpSections,
  getLogInkPaletteCommands,
} from '../../commands/log/inkKeymap'
import type { LogInkState } from '../../commands/log/inkViewModel'
import { getLogInkWorkflowActionById } from '../../commands/log/inkWorkflows'
import type { LogInkComponents } from './types'
import { focusBorderColor, panelTitle } from './utils'

export function renderInputPromptPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const prompt = state.inputPrompt
  if (!prompt) {
    return h(Box, { width })
  }

  const accent = theme.noColor ? undefined : theme.colors.accent
  // Multi-line prompts (#806) split on newline and render one Text
  // row per buffer line — the cursor sits at the end of the last
  // line via the trailing `_`. Single-line prompts collapse to the
  // original one-row layout for muscle-memory continuity.
  const promptLines = prompt.multiline ? prompt.value.split('\n') : [prompt.value]
  if (promptLines.length === 0) {
    promptLines.push('')
  }
  const valueRows = promptLines.map((line, index) => {
    const isLast = index === promptLines.length - 1
    const display = isLast ? `${line}_` : line
    return h(Text, {
      key: `prompt-line-${index}`,
      bold: true,
      color: accent,
    }, truncateCells(display, width - 4))
  })
  const hint = prompt.multiline
    ? 'Enter newline · Ctrl+d submit · Esc cancel · Ctrl+u clear'
    : 'Enter submit · Esc cancel · Ctrl+u clear'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Prompt', focused)),
  h(Text, { dimColor: true }, truncateCells(prompt.label, width - 4)),
  h(Text, undefined, ''),
  ...valueRows,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, hint))
}

export function renderConfirmationPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const action = getLogInkWorkflowActionById(state.pendingConfirmationId)
  const mutationLabel = state.pendingMutationConfirmation === 'revert-hunk'
    ? 'Revert selected hunk'
    : state.pendingMutationConfirmation === 'revert-file'
      ? 'Revert selected file'
      : state.pendingMutationConfirmation === 'discard-draft'
        ? 'Quit and discard the in-progress commit draft'
        : undefined
  const label = action?.label || mutationLabel || 'Workflow action'
  const warning = state.pendingMutationConfirmation === 'discard-draft'
    ? 'You have an unsaved commit draft. Press y to discard it and quit.'
    : state.pendingMutationConfirmation
    ? 'This discards local changes and cannot be undone by Coco.'
    : action?.kind === 'ai'
    ? `AI action requires confirmation. Estimated ${action.estimatedTokens || '<unknown>'} tokens.`
    : 'Destructive Git action requires confirmation.'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Confirm', focused)),
  h(Text, undefined, truncateCells(label, width - 4)),
  h(Text, { dimColor: true }, truncateCells(warning, width - 4)),
  h(Text, undefined, ''),
  h(Text, undefined, 'Press y to confirm or n/Esc to cancel.'))
}

/**
 * First-launch onboarding overlay (P1.3). Shown once per machine, gated
 * by an XDG-style cache marker so subsequent launches go straight to the
 * normal UI. Auto-dismisses on the next keystroke.
 *
 * Replaces the whole layout for the first render rather than overlaying
 * a transient banner — Ink doesn't support floating elements, and a full
 * takeover keeps the message readable on small terminals while still
 * being instantly dismissible.
 */
export function renderOnboardingOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  rows: number,
  columns: number,
  theme: LogInkTheme,
  appLabel: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const accent = theme.noColor ? undefined : theme.colors.accent
  const tips = [
    { keys: '?', text: 'open the help panel' },
    { keys: ':', text: 'open the command palette' },
    { keys: 'g h', text: 'jump to history (g s status, g d diff, g c compose, g b branches, g t tags, g z stash)' },
    { keys: '<  esc', text: 'pop the navigation stack / go back' },
    { keys: '/', text: 'filter the active list' },
    { keys: 'q  ctrl+c', text: 'quit' },
  ]
  const maxKeys = tips.reduce((max, tip) => Math.max(max, tip.keys.length), 0)
  const lineWidth = Math.max(40, columns - 4)

  return h(Box, {
    flexDirection: 'column',
    height: rows,
    paddingX: 2,
    paddingY: 1,
  },
  h(Text, { bold: true, color: accent }, `Welcome to ${appLabel}`),
  h(Text, { dimColor: true }, 'A quick keyboard tour — press any key to dismiss.'),
  h(Text, undefined, ''),
  ...tips.map((tip, index) => h(Text, { key: `onboarding-tip-${index}` },
    h(Text, { color: accent, bold: true }, `  ${tip.keys.padEnd(maxKeys)}  `),
    h(Text, undefined, truncateCells(tip.text, lineWidth - maxKeys - 4)))),
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, 'This tip is shown once per machine. Press any key to continue.'))
}

/**
 * Which-key style chord overlay (P1.1). When the user presses a chord
 * prefix (currently just `g`), the dispatcher sets `state.pendingKey`
 * and waits for the second key. This panel surfaces the available
 * continuations so newcomers don't have to memorize the chord set.
 *
 * Renders in the detail panel slot; auto-dismisses when the chord
 * completes or `pendingKey` is otherwise cleared.
 */
export function renderChordOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const prefix = state.pendingKey || ''
  const continuations = getLogInkChordContinuations(prefix)
  const accent = theme.noColor ? undefined : theme.colors.accent

  const lines: ReactTypes.ReactNode[] = [
    h(Text, { key: 'chord-title', bold: true }, panelTitle(`${prefix} … jump`, focused)),
    h(Text, { key: 'chord-spacer' }, ''),
  ]

  if (continuations.length === 0) {
    lines.push(h(Text, {
      key: 'chord-empty',
      dimColor: true,
    }, truncateCells(`No bindings registered for the ${prefix} prefix.`, width - 4)))
  } else {
    for (const entry of continuations) {
      lines.push(h(Text, { key: `chord-${entry.key}` },
        h(Text, { color: accent, bold: true }, `  ${entry.key}  `),
        h(Text, undefined, truncateCells(`${entry.label.padEnd(10)} ${entry.description}`, width - 9))
      ))
    }
  }

  lines.push(h(Text, { key: 'chord-foot-spacer' }, ''))
  lines.push(h(Text, {
    key: 'chord-hint',
    dimColor: true,
  }, truncateCells('press the second key to jump · esc cancels', width - 4)))

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...lines)
}

export function renderHelpPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const children: ReactTypes.ReactNode[] = [
    h(Text, { bold: true, key: 'title' }, panelTitle('Help', focused)),
  ]

  const sections = getLogInkHelpSections({
    activeView: state.activeView,
    focus: state.focus,
  })

  for (const section of sections) {
    children.push(h(Text, { key: `${section.title}-spacer` }, ''))
    children.push(h(Text, { bold: true, key: section.title }, section.title))
    section.bindings.forEach((binding) => {
      children.push(h(Text, { key: `${section.title}:${binding.id}` },
        truncateCells(`${formatBindingKeys(binding).padEnd(14)} ${binding.description}`, width - 4)
      ))
    })
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...children)
}

export function renderCommandPalette(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const all = getLogInkPaletteCommands()
  const filtered = filterLogInkPaletteCommands(all, state.paletteFilter, state.paletteRecent)
  const recentSet = new Set(state.paletteRecent)
  const showingRecent = !state.paletteFilter.trim() && state.paletteRecent.length > 0

  const selectedIndex = filtered.length === 0
    ? 0
    : Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))

  // Slide a window of rows around the selection so the cursor stays visible
  // even with hundreds of bindings.
  const listRows = 14
  const startIndex = Math.max(0, selectedIndex - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)

  const inputLine = `> ${state.paletteFilter}_`
  const matchSummary = filtered.length === 0
    ? 'no matches'
    : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`
  const hint = '↑/↓ select · enter run · esc close'

  const itemLines = filtered.length === 0
    ? [h(Text, { key: 'palette-empty', dimColor: true }, 'No commands match the current filter.')]
    : visible.map((command, offset) => {
      const index = startIndex + offset
      const isSelected = index === selectedIndex
      const cursor = isSelected ? '>' : ' '
      const recentMarker = showingRecent && recentSet.has(command.id) ? '·' : ' '
      const kindMarker = command.kind === 'workflow'
        ? command.workflowKind === 'ai'
          ? '[AI]'
          : command.requiresConfirmation
            ? '[confirm]'
            : '[action]'
        : ''
      const line = `${cursor} ${recentMarker} ${command.keys.padEnd(8)} ${command.label.padEnd(20)} ${kindMarker ? `${kindMarker} ` : ''}${command.description}`
      return h(Text, {
        key: `palette-${command.kind}-${command.id}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncateCells(line, width - 4))
    })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Command palette', focused)),
    h(Text, { dimColor: true }, matchSummary)
  ),
  h(Text, { color: theme.colors.accent }, truncateCells(inputLine, width - 4)),
  h(Text, { dimColor: true }, truncateCells(hint, width - 4)),
  h(Text, undefined, ''),
  ...(showingRecent
    ? [h(Text, { key: 'palette-recent-hint', dimColor: true }, '· marks recently-used')]
    : []),
  ...itemLines)
}

/**
 * Split-plan overlay (#907) — renders the proposed commit groups for
 * the user to review before applying. Three phases driven by
 * `state.splitPlan.status`:
 *
 *   - 'loading'  : spinner-ish copy while plan generation is in flight.
 *                  Esc cancels (soft — the in-flight LLM resolves
 *                  silently after; runtime ignores the result).
 *   - 'ready'    : scrollable list of groups. Each group shows the
 *                  proposed title, optional body, files, and (when
 *                  available) rationale. Footer hints: j/k scroll,
 *                  y/Enter apply, Esc cancel.
 *   - 'applying' : same content as 'ready' but a status banner
 *                  surfaces "Applying…" so the user knows the apply
 *                  is in flight. Keystrokes are consumed but no-op.
 *
 * Errors during apply keep the overlay open in 'ready' state with
 * an `error` annotation in the header — user can retry or back out.
 */
// Braille-dot spinner frames — same set used by ora, ink-spinner, and
// most other Node TUI tools. 10 frames at 80ms each gives a smooth
// loop that reads as a true spinner rather than a flicker.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function renderSplitPlanOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  bodyRows: number,
  theme: LogInkTheme,
  focused: boolean,
  spinnerFrame: number = 0
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const overlay = state.splitPlan
  if (!overlay) {
    return h(Box, { width })
  }

  const maxLineWidth = Math.max(20, width - 4)
  const listRows = Math.max(4, bodyRows - 3)
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]

  // Loading state — overlay opens immediately so the user sees the
  // "in flight" feedback without staring at a frozen compose view.
  // The spinner gives motion so the user knows something's still
  // happening even on slow LLM responses (which can take 30s+ on
  // larger staged sets).
  if (overlay.status === 'loading') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Commit split', focused)),
      h(Text, { color: theme.colors.accent }, `${spinner} generating plan…`)
    ),
    h(Text, undefined, ''),
    h(Text, { color: theme.colors.accent }, `${spinner}  Asking the model to split the staged changes into coherent commits.`),
    h(Text, { dimColor: true }, '   This can take 30 seconds to a minute on larger sets.'),
    h(Text, undefined, ''),
    h(Text, { dimColor: true }, '   Esc cancels.'))
  }

  // Ready / applying — render the groups. We render to a virtual
  // line list first, then slice by scrollOffset so j/k/PgUp/PgDn
  // behave like every other scrollable surface in the workstation.
  const plan = overlay.plan
  if (!plan) {
    // Safety: shouldn't hit this since the reducer guarantees plan
    // is set when status is 'ready' or 'applying'. Render an empty
    // overlay rather than crashing.
    return h(Box, { width },
      h(Text, { dimColor: true }, 'No plan data available.'))
  }

  const lines: string[] = []
  plan.groups.forEach((group, index) => {
    lines.push(`▎ ${index + 1}. ${group.title}`)
    if (group.body) {
      group.body.split('\n').forEach((bodyLine) => lines.push(`  ${bodyLine}`))
    }
    if (group.rationale) {
      lines.push('')
      lines.push(`  why: ${group.rationale}`)
    }
    const files = group.files || []
    if (files.length > 0) {
      lines.push('')
      lines.push(`  files (${files.length}):`)
      files.forEach((file) => lines.push(`    · ${file}`))
    }
    const hunks = group.hunks || []
    if (hunks.length > 0) {
      lines.push('')
      lines.push(`  hunks (${hunks.length}):`)
      hunks.forEach((hunkId) => lines.push(`    · ${hunkId}`))
    }
    lines.push('')
  })

  const totalLines = lines.length
  const scrollOffset = Math.min(overlay.scrollOffset, Math.max(0, totalLines - 1))
  const visible = lines.slice(scrollOffset, scrollOffset + listRows)

  const headerRight = overlay.status === 'applying'
    ? `${spinner} applying…`
    : `${plan.groups.length} commit(s) · ${scrollOffset + 1}–${Math.min(totalLines, scrollOffset + listRows)} / ${totalLines}`

  // Apply errors get the full available width — long validator
  // messages (the failure path that surfaced in PR #916 testing was
  // "unknown hunks: src/widgets/button.ts::hunk-1, ...") frequently
  // exceed footer-status-line capacity. We wrap into multiple lines
  // here, color them red + bold, and surface a retry hint underneath.
  const errorBlock = overlay.error
    ? wrapErrorMessage(overlay.error, maxLineWidth)
    : []

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Commit split — review plan', focused)),
    h(Text, {
      bold: overlay.status === 'applying',
      color: overlay.status === 'applying' ? theme.colors.accent : undefined,
      dimColor: overlay.status !== 'applying',
    }, headerRight)
  ),
  ...errorBlock.map((line, offset) => h(Text, {
    key: `split-plan-error-${offset}`,
    color: 'red',
    bold: offset === 0,
  }, line)),
  ...(overlay.error
    ? [h(Text, { key: 'split-plan-error-hint', dimColor: true }, '   Press `r` to retry, `Esc` to cancel.')]
    : []),
  ...visible.map((line, offset) => h(Text, {
    key: `split-plan-${scrollOffset + offset}`,
  }, truncateCells(line || ' ', maxLineWidth))))
}

/**
 * Wrap a long error message into multiple lines fit to the overlay
 * width. Used for split-plan errors which can carry validator output
 * listing offending hunks/files — frequently long enough to overflow
 * a single line. Returns `[]` for empty input so callers can spread
 * directly into a child list.
 */
function wrapErrorMessage(message: string, maxWidth: number): string[] {
  if (!message) return []
  const prefix = '✗ '
  const continuation = '  '
  // Naive wrapping by words. Good enough for validator-style
  // messages which are space-delimited; longer words just get
  // truncated by Ink's natural rendering, which is acceptable.
  const words = message.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = prefix
  for (const word of words) {
    const candidate = current === prefix ? `${current}${word}` : `${current} ${word}`
    if (candidate.length > maxWidth && current !== prefix) {
      lines.push(current)
      current = `${continuation}${word}`
    } else {
      current = candidate
    }
  }
  if (current.trim()) {
    lines.push(current)
  }
  return lines
}
