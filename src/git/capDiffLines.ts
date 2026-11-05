/**
 * Maximum diff lines kept per loaded diff (#1365 item 5, #2209). Prevents
 * huge generated files (bundle diffs, lockfiles) from flooding the renderer
 * and the hunk/file parsers; the TUI only draws ~40 lines at a time anyway.
 */
export const MAX_DIFF_LINES = 8000

/**
 * Trim `lines` to {@link MAX_DIFF_LINES} and append a "truncated" footer.
 * Returns the input untouched when it is within the cap.
 */
export function capDiffLines(lines: string[], max: number = MAX_DIFF_LINES): string[] {
  if (lines.length <= max) {
    return lines
  }
  return [
    ...lines.slice(0, max),
    '',
    `… truncated (${lines.length - max} more lines — open in $EDITOR for the full diff)`,
  ]
}
