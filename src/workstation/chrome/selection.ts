import type { LogInkTheme } from './theme'

/**
 * Text props for the cursor row of a list (#2162). Every list used to mark
 * its cursor its own way: history a background, branches bold alone (weak
 * on many themes), workspace a caret, status a `>` plus background. Users
 * learn "where am I?" once, so every list uses this.
 *
 * - Colour: the selection background with its contrast-checked foreground,
 *   the treatment the history rows already use. Spread it after any row
 *   colour so the selection foreground wins.
 * - NO_COLOR: reverse video.
 * - Unfocused pane: underlined and bold, so the inactive cursor stays
 *   visible but reads as secondary to the focused pane's.
 */
export function selectionRowProps(
  theme: LogInkTheme,
  selected: boolean,
  focused = true,
): { bold?: boolean; inverse?: boolean; underline?: boolean; backgroundColor?: string; color?: string } {
  if (!selected) return {}
  if (!focused) return { bold: true, underline: true }
  if (theme.noColor) return { bold: true, inverse: true }
  return { bold: true, backgroundColor: theme.colors.selection, color: theme.colors.selectionForeground }
}

/**
 * Props for a coloured segment inside a cursor row. On the focused
 * selection background a segment's own colour or dim fights the contrast-
 * checked selection foreground (#2162 review), so it yields to the row;
 * elsewhere it keeps its colour, dimmed off the cursor row.
 */
export function selectionSegmentProps(
  theme: LogInkTheme,
  selected: boolean,
  focused: boolean,
  color?: string,
  options: { alwaysDim?: boolean } = {},
): { color?: string; dimColor?: boolean } {
  if (selected && focused && !theme.noColor) return {}
  return { color: theme.noColor ? undefined : color, dimColor: options.alwaysDim || !selected }
}
