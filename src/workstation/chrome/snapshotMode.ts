/**
 * Snapshot-mode helpers for deterministic UI rendering during VHS
 * screenshot captures and visual regression checks.
 *
 * The TUI has a few sources of nondeterminism that make screenshot
 * diffs flicker between runs even when nothing real has changed:
 *
 *   - relative dates ("3d ago" / "2 mo") drift as the wall clock advances
 *   - the spinner advances on a 80ms tick during loading states
 *   - the idle-tip rotation swaps copy every 8 seconds
 *
 * Idle tips are off by default (opt-in via `logTui.idleTips`) so we
 * already have that one. Spinner only ticks during loading states so
 * a static screenshot of a settled view doesn't see spinner motion.
 *
 * The remaining knob is `now` — the wall-clock value relative-date
 * formatters consult. Setting `COCO_SNAPSHOT_NOW` to an ISO 8601
 * timestamp (e.g. `2026-05-27T12:00:00Z`) freezes every render-path
 * `new Date()` call to that fixed instant. Run inside the
 * screenshot harness; never set in production.
 */

let cachedNow: Date | undefined
let cachedNowError = false

/**
 * Resolve the wall-clock `now` to use in render paths. When
 * `COCO_SNAPSHOT_NOW` is set to a parseable ISO date, returns the
 * pinned value; otherwise returns a fresh `new Date()`.
 *
 * Exported for the workstation surfaces that need a `now` reference
 * (history bucketing, branch "last touched" relative formatting,
 * etc.). Production code paths get the same call shape they had
 * before — the env knob is silently inert when unset.
 */
export function getRenderNow(): Date {
  const env = process.env.COCO_SNAPSHOT_NOW
  if (!env) return new Date()

  const parsed = new Date(env)
  if (Number.isNaN(parsed.valueOf())) {
    if (!cachedNowError) {
      cachedNowError = true
      // eslint-disable-next-line no-console
      console.warn(
        `[coco] COCO_SNAPSHOT_NOW="${env}" is not a parseable ISO date; falling back to live wall clock.`
      )
    }
    return new Date()
  }

  // Memoize — multiple surfaces in the same render tree call this,
  // and the value is constant for a given env state. Re-parse only
  // when the env value actually changed (vanishingly rare; supported
  // so tests can flip the var without restarting the process).
  if (cachedNow && cachedNow.valueOf() === parsed.valueOf()) {
    return cachedNow
  }

  cachedNow = parsed
  cachedNowError = false
  return parsed
}

/**
 * True when snapshot mode is active. Use sparingly — most code paths
 * should just call `getRenderNow()` and let the caller decide whether
 * to pin the clock. This helper is for places that want to disable
 * other animations entirely (e.g. skip a spinner tick effect).
 */
export function isSnapshotMode(): boolean {
  return Boolean(process.env.COCO_SNAPSHOT_NOW)
}
