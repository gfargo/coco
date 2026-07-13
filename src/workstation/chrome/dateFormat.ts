/**
 * Date formatting helpers for the Ink TUI surfaces.
 *
 * The branch list already ships its own "X ago" formatter
 * (`formatBranchLastTouched` in iconography.ts) sized for a sidebar
 * row with room to breathe. The history surface needs a tighter
 * variant: the date column is fixed-width and competes with the
 * commit message for cells, so a 2-3 character form is the budget.
 *
 * Inputs are `YYYY-MM-DD` in the VIEWER's local zone
 * (`--date=format-local:%Y-%m-%d` in git/logData.ts). Caller
 * passes `now` so tests can pin the reference instant.
 *
 * Outputs (rounded toward the nearest unit, no `ago` suffix):
 *   - `today` for same UTC day
 *   - `1d` … `13d` for 1-13 days
 *   - `2w` … `8w` for 2-8 weeks
 *   - `2mo` … `11mo` for 2-11 months
 *   - `2y`+ for older
 *   - `''` for malformed inputs (caller renders nothing)
 *
 * Day comparison uses the viewer's LOCAL day on both sides (#1336):
 * the commit day is already viewer-local, so truncating `now` to the
 * viewer's local day keeps "today" meaning the user's own today.
 * (`Date.UTC` below is just a timezone-free day-arithmetic device.)
 */
export function formatCompactRelativeDate(iso: string | undefined, now: Date): string {
  if (!iso) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''

  const commitDay = Date.UTC(year, month - 1, day)
  // Viewer-LOCAL day components — see the header note (#1336).
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const oneDay = 24 * 60 * 60 * 1000
  const days = Math.floor((nowDay - commitDay) / oneDay)

  if (days <= 0) return 'today'
  if (days < 14) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks}w`

  // Gate on days, not the rounded month count: days 360-364 floor to
  // 12 "months" but 0 years, which used to render as a nonsense `0y`.
  const months = Math.floor(days / 30)
  if (days < 365) return `${months}mo`

  const years = Math.floor(days / 365)
  return `${years}y`
}

/**
 * Maximum cell width any output from `formatCompactRelativeDate` will
 * occupy. Used by row-layout math that needs to reserve a fixed
 * column width up front rather than measuring each formatted string.
 *
 * `today` (5) is the longest single output; `99mo` would be 4. We pin
 * to 5 to leave headroom for the `today` case without re-measuring.
 */
export const COMPACT_RELATIVE_DATE_MAX_WIDTH = 5
