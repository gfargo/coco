/**
 * Time helpers for pinning commit dates in deterministic scenarios.
 *
 * The atoms that accept a `date` option (`addCommit`, `commit`,
 * `emptyCommit`, `amendCommit`, `startMerge`) take any ISO-8601 string
 * git's `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` accept. The helpers
 * below produce stable ISO strings for the patterns scenarios actually
 * want — "N days before now," "an absolute calendar date."
 */

/**
 * Return an ISO-8601 timestamp at noon UTC for the date N days before
 * the current run time. Noon UTC is picked so the date portion is
 * stable across timezones — the bucketing in downstream tools compares
 * at day granularity, so the time-of-day component is irrelevant
 * beyond keeping the date deterministic.
 *
 *   addCommit({ message: 'feat: x', date: daysAgo(15) })
 *
 * Returns differ between runs (the result depends on "now"), so this
 * is for relative-time scenarios — date-bucket testing, "last week"
 * vs. "this week" rendering, recent-activity sorts. For
 * frozen-in-amber dates, pass an absolute ISO string directly.
 */
export function daysAgo(n: number): string {
  const now = new Date()
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - n,
      12,
      0,
      0,
    ),
  )
  return d.toISOString()
}
