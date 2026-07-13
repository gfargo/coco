/**
 * Map a commit date to a section bucket so the history surface can
 * group adjacent commits under a single header instead of repeating
 * a date column on every row. Buckets are mutually exclusive and
 * ordered from "most recent" to "oldest":
 *
 *   today               — same UTC day as `now`
 *   yesterday           — exactly 1 day ago
 *   this-week           — 2-6 days ago
 *   last-week           — 7-13 days ago
 *   earlier-this-month  — within the calendar month of `now`, > 13 days
 *   month-YYYY-MM       — older months (one bucket per month)
 *
 * The `key` is what the renderer dedupes on (consecutive commits in
 * the same bucket share one header). The `label` is what gets
 * printed in the divider. Day-granularity comparison uses the
 * VIEWER's local calendar day on both sides (#1336): commit dates
 * arrive as viewer-local days (`--date=format-local:%Y-%m-%d` in
 * git/logData.ts) and `now` is truncated to the viewer's local
 * day, so "Today" always means the user's own today. (`Date.UTC` in
 * the math below is just a timezone-free day-arithmetic device.)
 *
 * Malformed inputs (missing or unparseable iso) return a fallback
 * bucket whose key is `unknown`; the renderer can choose to emit a
 * header or skip the bucket entirely.
 */
export type DateBucket = {
  key: string
  label: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export function getDateBucket(iso: string | undefined, now: Date): DateBucket {
  if (!iso) return { key: 'unknown', label: 'Unknown date' }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return { key: 'unknown', label: 'Unknown date' }

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { key: 'unknown', label: 'Unknown date' }
  }

  const commitDay = Date.UTC(year, month - 1, day)
  // Viewer-LOCAL day components (#1336) — the commit day is already in
  // the viewer's zone, so the reference day must be too, or a commit
  // made after UTC midnight (e.g. 8pm Pacific) lands under Yesterday.
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const oneDay = 24 * 60 * 60 * 1000
  const days = Math.floor((nowDay - commitDay) / oneDay)

  // Future-dated commits (clock skew, bad commit dates) collapse to
  // today rather than confusing the user with an "in the future"
  // bucket.
  if (days <= 0) return { key: 'today', label: 'Today' }
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' }
  if (days < 7) return { key: 'this-week', label: 'This week' }
  if (days < 14) return { key: 'last-week', label: 'Last week' }

  // Inside the same calendar month → one "earlier this month" bucket
  // so the user sees a single section rather than per-day groupings
  // for a commit-heavy week.
  if (year === now.getFullYear() && month - 1 === now.getMonth()) {
    return { key: 'earlier-this-month', label: 'Earlier this month' }
  }

  // Older months use the calendar-month label so the bucket reads
  // naturally even years back (`April 2024`). The key embeds the
  // year+month so different months stay in distinct buckets without
  // colliding on month name alone.
  const monthLabel = MONTH_NAMES[month - 1] ?? `Month ${month}`
  return {
    key: `month-${match[1]}-${match[2]}`,
    label: `${monthLabel} ${year}`,
  }
}
