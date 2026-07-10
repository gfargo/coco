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
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { deriveGitignoreOptions } from '../chrome/gitignore'
import { pickSpinnerFrame } from '../chrome/spinner'
import { truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import { THEME_PRESET_COLORS } from '../chrome/theme'
import {
    filterLogInkPaletteCommands,
    formatBindingBareKeys,
    formatBindingKeys,
    getLogInkChordContinuations,
    getLogInkHelpSections,
    getLogInkPaletteCommands,
    getLogInkViewKeyBindings,
} from '../../workstation/runtime/inkKeymap'
import type { LogInkChoicePrompt, LogInkState } from '../../workstation/runtime/inkViewModel'
import { filterThemePresets } from '../../workstation/runtime/inkViewModel'
import { getLogInkWorkflowActionById } from '../../workstation/runtime/inkWorkflows'
import { getSelectedCommitTarget } from '../../workstation/runtime/selection'
import { resolvePendingItemAction } from './hooks/useWorkflowAction'
import type { LogInkContext } from './types'
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

/**
 * Cap on how many batch target names the confirm panel spells out
 * inline (#1361). Beyond it the line abbreviates to "+N more" so a
 * 20-item batch can't overflow a 24-row terminal — the count is always
 * exact even when the names are truncated.
 */
const CONFIRMATION_TARGET_NAME_CAP = 4

/**
 * Human line naming the item(s) a pending confirmation will act on, or
 * undefined when the workflow has no resolvable target. Shown in the
 * confirm overlay so the user never confirms blind — several
 * destructive keys (D / T / X / W) reach the confirm from views where
 * the target list isn't even on screen, and a batch confirm (#1361)
 * must name every marked item or the user confirms one and acts on N.
 *
 * Everything list-shaped (branch/tag/stash/worktree deletes and
 * checkouts) resolves through `resolvePendingItemAction` — the same
 * sorted+filtered resolver the runner and row spinners use. The
 * commit-target workflows (cherry-pick, revert, rebase, etc.) resolve
 * through `getSelectedCommitTarget` (#1452), the commit counterpart of
 * the id-based selection selectors.
 */
export function describeConfirmationTarget(
  state: LogInkState,
  context: LogInkContext,
): string | undefined {
  const id = state.pendingConfirmationId
  if (!id) return undefined
  const item = resolvePendingItemAction(id, state, context)
  if (item && item.ids.length === 1) {
    return `${item.kind}: ${item.ids[0]}`
  }
  if (item && item.ids.length > 1) {
    const shown = item.ids.slice(0, CONFIRMATION_TARGET_NAME_CAP)
    const overflow = item.ids.length - shown.length
    const names = overflow > 0 ? `${shown.join(', ')} +${overflow} more` : shown.join(', ')
    // branch/stash pluralize with -es; tag/worktree/pull-request with -s.
    const plural = /(ch|sh)$/.test(item.kind) ? `${item.kind}es` : `${item.kind}s`
    return `${item.ids.length} ${plural}: ${names}`
  }
  const commit = getSelectedCommitTarget(id, state)
  if (commit) {
    return `commit ${commit.shortHash}: ${commit.message}`
  }
  return undefined
}

export function renderConfirmationPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const action = getLogInkWorkflowActionById(state.pendingConfirmationId)
  const label = action?.label || 'Workflow action'
  // #1451 — prefer the registry's warning field over any fallback. Most
  // entries carry a static string; a few (rebase-onto-branch,
  // checkout-created-branch) need payload-dependent copy and supply a
  // function instead (#1452 nice-to-have — replaces the old per-id
  // if-chain here).
  const registryWarning = typeof action?.warning === 'function'
    ? action.warning(state)
    : action?.warning
  const warning =
    registryWarning
    ? registryWarning
    : action?.kind === 'ai'
    ? `AI action requires confirmation. Estimated ${action.estimatedTokens || '<unknown>'} tokens.`
    : 'Destructive Git action requires confirmation.'
  const target = describeConfirmationTarget(state, context)

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Confirm', focused)),
  h(Text, undefined, truncateCells(label, width - 4)),
  ...(target ? [h(Text, { bold: true }, truncateCells(`\u2192 ${target}`, width - 4))] : []),
  h(Text, { dimColor: true }, truncateCells(warning, width - 4)),
  h(Text, undefined, ''),
  h(Text, undefined, 'Press y to confirm or n/Esc to cancel.'))
}

/**
 * Multi-option prompt panel (#1181) — the n-way generalization of the
 * confirmation panel. Renders the prompt title, an optional warning, and
 * one row per option (`<key>  <label>`, destructive options in the
 * danger colour), plus a cancel hint. Resolution happens in the input
 * layer by matching a keypress against the option keys.
 */
export function renderChoicePanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  prompt: LogInkChoicePrompt,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Choose', focused)),
  h(Text, undefined, truncateCells(prompt.title, width - 4)),
  ...(prompt.warning ? [h(Text, { dimColor: true }, truncateCells(prompt.warning, width - 4))] : []),
  h(Text, undefined, ''),
  ...prompt.options.map((option) => h(Text, {
    key: `choice-${prompt.id}-${option.key}`,
    color: option.destructive && !theme.noColor ? theme.colors.danger : undefined,
  }, truncateCells(`  ${option.key}  ${option.label}`, width - 4))),
  h(Text, { dimColor: true }, '  n/Esc  cancel'))
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

/**
 * Which-key view-keys strip (#1137). The per-view counterpart to the
 * `g`-chord overlay: opened by `g?`, it lists the single-key actions
 * available in the current view (the deliberate overloads — `c`, `R`,
 * `a`, `m`, `S`, `[`/`]`, …) with their labels, sourced from
 * `LOG_INK_KEY_BINDINGS` filtered by the active view + focus.
 *
 * Renders in the detail panel slot like the chord overlay. `?` steps up
 * to the full categorized help; Esc closes.
 */
export function renderViewKeysOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const bindings = getLogInkViewKeyBindings({
    activeView: state.activeView,
    focus: state.focus,
  })
  const accent = theme.noColor ? undefined : theme.colors.accent

  const lines: ReactTypes.ReactNode[] = [
    h(Text, { key: 'view-keys-title', bold: true }, panelTitle(`keys · ${state.activeView}`, focused)),
    h(Text, { key: 'view-keys-spacer' }, ''),
  ]

  if (bindings.length === 0) {
    lines.push(h(Text, {
      key: 'view-keys-empty',
      dimColor: true,
    }, truncateCells('No single-key actions in this view — use ? for the full help.', width - 4)))
  } else {
    // Pad keys to the widest entry so labels align into a scannable column.
    const keyColumn = bindings.reduce(
      (max, binding) => Math.max(max, formatBindingBareKeys(binding).length),
      0
    )
    for (const binding of bindings) {
      const keys = formatBindingBareKeys(binding)
      lines.push(h(Text, { key: `view-keys-${binding.id}` },
        h(Text, { color: accent, bold: true }, `  ${keys.padEnd(keyColumn)}  `),
        h(Text, undefined, truncateCells(`${binding.label.padEnd(14)} ${binding.description}`, width - keyColumn - 7))
      ))
    }
  }

  lines.push(h(Text, { key: 'view-keys-foot-spacer' }, ''))
  lines.push(h(Text, {
    key: 'view-keys-hint',
    dimColor: true,
  }, truncateCells('? full help · esc closes', width - 4)))

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
  focused: boolean,
  bodyRows: number = 0
): ReactTypes.ReactElement {
  const { Box, Text } = components

  // Build the full list of body rows (everything below the title).
  // Splitting into title + body lets us window the body by
  // `state.helpScrollOffset` while keeping the title pinned.
  const body: ReactTypes.ReactNode[] = []
  const sections = getLogInkHelpSections({
    activeView: state.activeView,
    focus: state.focus,
  })

  // Type-to-filter (#1355): narrow rows by key / label / description,
  // case-insensitive substring. Subgroups and sections that filter to
  // empty drop out entirely so matches aren't buried under headings.
  const helpQuery = state.helpFilter.trim().toLowerCase()
  const bindingMatches = (binding: (typeof sections)[number]['bindings'][number]): boolean => {
    if (!helpQuery) return true
    return (
      formatBindingKeys(binding).toLowerCase().includes(helpQuery) ||
      binding.label.toLowerCase().includes(helpQuery) ||
      binding.description.toLowerCase().includes(helpQuery)
    )
  }

  let matchedAny = false
  for (const section of sections) {
    const subgroups = section.subgroups
      .map((subgroup) => ({ ...subgroup, bindings: subgroup.bindings.filter(bindingMatches) }))
      .filter((subgroup) => subgroup.bindings.length > 0)
    if (subgroups.length === 0) {
      continue
    }
    matchedAny = true
    body.push(h(Text, { key: `${section.title}-spacer` }, ''))
    body.push(h(Text, { bold: true, key: section.title }, section.title))
    subgroups.forEach((subgroup, subgroupIndex) => {
      // Dim subgroup heading; first subgroup follows the section
      // title directly so we skip the leading spacer to keep the
      // visual hierarchy tight (section title → subgroup → bindings).
      if (subgroupIndex > 0) {
        body.push(h(Text, { key: `${section.title}:${subgroup.category}:spacer` }, ''))
      }
      body.push(h(Text, {
        dimColor: true,
        key: `${section.title}:${subgroup.category}`,
      }, `  ${subgroup.title}`))
      subgroup.bindings.forEach((binding) => {
        body.push(h(Text, { key: `${section.title}:${subgroup.category}:${binding.id}` },
          truncateCells(`  ${formatBindingKeys(binding).padEnd(12)} ${binding.description}`, width - 4)
        ))
      })
    })
  }
  if (!matchedAny && helpQuery) {
    body.push(h(Text, { key: 'help-no-match', dimColor: true },
      truncateCells(`No bindings match "${state.helpFilter}" — esc clears the filter.`, width - 4)))
  }

  // Reserve rows for: title (1), border (2), padding (0). The "more
  // above" / "more below" hints take 1 row each when present and are
  // accounted for inside the window calculation below. When no
  // bodyRows is provided, fall back to rendering everything (legacy
  // path; tests pass undefined).
  const filterRow = state.helpFilterMode || state.helpFilter ? 1 : 0
  const titleAndChromeRows = 3 + filterRow
  const visibleRows = bodyRows > 0
    ? Math.max(4, bodyRows - titleAndChromeRows)
    : body.length

  // Clamp the offset against actual content length. The reducer
  // only floor-clamps at 0; here we ceiling-clamp so j past EOF
  // sticks at the last row rather than scrolling into emptiness.
  const maxOffset = Math.max(0, body.length - visibleRows)
  const offset = Math.min(state.helpScrollOffset, maxOffset)

  const children: ReactTypes.ReactNode[] = [
    h(Text, { bold: true, key: 'title' }, panelTitle('Help', focused)),
  ]
  // Filter input line (#1355). Rendered while typing (cursor shown)
  // and while a committed filter narrows the list, so the narrowing is
  // never invisible.
  if (state.helpFilterMode || state.helpFilter) {
    children.push(h(Text, { key: 'help-filter' },
      truncateCells(`filter: ${state.helpFilter}${state.helpFilterMode ? '_' : ''}`, width - 4)))
  }

  // Visual hint that there's content scrolled above. The dim style
  // matches the rest of the chrome's "metadata" voice and avoids
  // stealing attention from the bindings themselves.
  if (offset > 0) {
    children.push(h(Text, { key: 'more-above', dimColor: true }, '↑ more above (j/k or ↑/↓ to scroll)'))
  }

  // Reserve a row each for the visible "more above" / "more below"
  // hints so they don't push body content off-screen.
  let windowSize = visibleRows
  if (offset > 0) windowSize -= 1
  const hasMoreBelow = offset + windowSize < body.length
  if (hasMoreBelow) windowSize -= 1

  children.push(...body.slice(offset, offset + windowSize))

  if (hasMoreBelow) {
    children.push(h(Text, { key: 'more-below', dimColor: true }, '↓ more below (j/k or ↑/↓ to scroll)'))
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

  // Scroll indicators for the palette list — same pattern as the
  // sidebar and help overlay so the user knows there's more content.
  const paletteHasMoreAbove = startIndex > 0 && filtered.length > 0
  const paletteHasMoreBelow = startIndex + listRows < filtered.length

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
  ...(paletteHasMoreAbove
    ? [h(Text, { key: 'palette-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...itemLines,
  ...(paletteHasMoreBelow
    ? [h(Text, { key: 'palette-more-below', dimColor: true }, `  ↓ ${filtered.length - (startIndex + listRows)} more below`)]
    : []))
}

/**
 * Theme picker overlay (`gC`). Renders like the command palette so the
 * rest of the surface live-previews the cursored theme underneath. Type to
 * filter, ↑/↓ to move, Enter applies (and persists), Esc cancels. Takes the
 * raw `filter` + `index` rather than a `LogInkState` so it's reusable by
 * the workspace top-level surface, which has its own state model.
 */
export function renderThemePickerOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  filter: string,
  index: number,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const filtered = filterThemePresets(filter)

  const selectedIndex = filtered.length === 0
    ? 0
    : Math.max(0, Math.min(index, filtered.length - 1))

  const listRows = 14
  const startIndex = Math.max(0, selectedIndex - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)

  const inputLine = `> ${filter}_`
  const matchSummary = filtered.length === 0
    ? 'no matches'
    : `${filtered.length} ${filtered.length === 1 ? 'theme' : 'themes'}`
  const hint = '↑/↓ select · type to filter · enter apply · esc close'

  const itemLines = filtered.length === 0
    ? [h(Text, { key: 'theme-empty', dimColor: true }, 'No themes match the current filter.')]
    : visible.map((preset, offset) => {
      const index = startIndex + offset
      const isSelected = index === selectedIndex
      const cursor = isSelected ? '>' : ' '
      // Accent swatch per theme (no swatch for the monochrome baseline or
      // when color is off). `default` is the only ANSI-named accent.
      const accent = preset === 'monochrome'
        ? undefined
        : THEME_PRESET_COLORS[preset]?.accent
      const swatch = accent && !theme.noColor
        ? h(Text, { key: `theme-swatch-${preset}`, color: accent }, '● ')
        : h(Text, { key: `theme-swatch-${preset}`, dimColor: true }, '· ')
      return h(Text, {
        key: `theme-${preset}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, `${cursor} `, swatch, truncateCells(preset, width - 8))
    })

  const hasMoreAbove = startIndex > 0 && filtered.length > 0
  const hasMoreBelow = startIndex + listRows < filtered.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Theme picker', focused)),
    h(Text, { dimColor: true }, matchSummary)
  ),
  h(Text, { color: theme.colors.accent }, truncateCells(inputLine, width - 4)),
  h(Text, { dimColor: true }, truncateCells(hint, width - 4)),
  h(Text, undefined, ''),
  ...(hasMoreAbove
    ? [h(Text, { key: 'theme-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...itemLines,
  ...(hasMoreBelow
    ? [h(Text, { key: 'theme-more-below', dimColor: true }, `  ↓ ${filtered.length - (startIndex + listRows)} more below`)]
    : []))
}

/**
 * "Add to .gitignore" quick-pick overlay (`i` on the status view).
 * Modeled on the theme picker but with a fixed, file-derived option list
 * (no fuzzy filter — the menu is short): pick exact / by-extension /
 * by-folder / by-name, or the `Custom pattern…` escape hatch which opens
 * a free-text prompt. ↑/↓ to move, Enter to choose, Esc to cancel.
 */
export function renderGitignorePickerOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  file: string,
  index: number,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const options = deriveGitignoreOptions(file)
  const selectedIndex = Math.max(0, Math.min(index, options.length - 1))
  const hint = '↑/↓ select · enter add · esc cancel'

  const itemLines = options.map((option, offset) => {
    const isSelected = offset === selectedIndex
    const cursor = isSelected ? '>' : ' '
    const glyph = option.custom ? '✎ ' : '+ '
    return h(Text, {
      key: `gitignore-opt-${offset}`,
      bold: isSelected,
      dimColor: !isSelected,
      color: isSelected && !theme.noColor ? theme.colors.accent : undefined,
    }, `${cursor} ${glyph}`, truncateCells(option.label, width - 8))
  })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Add to .gitignore', focused)),
    h(Text, { dimColor: true }, `${options.length} options`)
  ),
  h(Text, { color: theme.colors.accent }, truncateCells(file || '(no file)', width - 4)),
  h(Text, { dimColor: true }, truncateCells(hint, width - 4)),
  h(Text, undefined, ''),
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
// Spinner frames live in `chrome/spinner.ts` so every surface that
// renders a loading state (overlays, surfaces, footer) shares one
// vocabulary of motion.

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
  const spinner = pickSpinnerFrame(spinnerFrame)

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

  // Committed groups are numbered 1..N; an `unclaimed` group (the files
  // the split couldn't place) renders as a distinct "will stay" note
  // rather than a phantom commit (#1180).
  const committedGroups = plan.groups.filter((group) => !group.unclaimed)
  const lines: string[] = []

  // #1462: a dedupe rescue silently dropped a file/hunk placement the
  // model had also put in an earlier group — the plan still validates
  // cleanly, so without this the user has no hint a placement was
  // auto-resolved. Same `⚠` visual language as the `unclaimed` note
  // above, surfaced before the group listing so it's seen up front.
  const dedupeWarnings = overlay.dedupeWarnings || []
  if (dedupeWarnings.length > 0) {
    lines.push(
      `⚠ ${dedupeWarnings.length} placement${dedupeWarnings.length === 1 ? '' : 's'} auto-resolved — model listed the same ${dedupeWarnings.length === 1 ? 'item' : 'items'} in more than one commit:`
    )
    dedupeWarnings.forEach((note) => {
      const dropped = note.droppedGroupTitles.join(', ')
      lines.push(`  · ${note.id}: kept in "${note.keptGroupTitle}", dropped from "${dropped}"`)
    })
    lines.push('')
  }

  let commitNumber = 0
  plan.groups.forEach((group) => {
    if (group.unclaimed) {
      lines.push(`⚠ ${group.title}  (stays in your worktree — not committed)`)
    } else {
      commitNumber += 1
      lines.push(`▎ ${commitNumber}. ${group.title}`)
    }
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

  const unclaimedCount = plan.groups.length - committedGroups.length
  const headerRight = overlay.status === 'applying'
    ? `${spinner} applying…`
    : `${committedGroups.length} commit(s)${unclaimedCount ? ' · 1 set stays staged' : ''} · ${scrollOffset + 1}–${Math.min(totalLines, scrollOffset + listRows)} / ${totalLines}`

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
