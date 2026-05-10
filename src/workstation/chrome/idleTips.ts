/**
 * Idle status-line tip rotation (P4.3).
 *
 * Off by default; opt-in via `logTui.idleTips: true`. The runtime drives a
 * tick counter that this module turns into a tip — pure mapping so the
 * cadence + content can be tested without spinning React or timers.
 *
 * Convention:
 *   - tickIndex 0   → no tip (initial grace, before the first idle window).
 *   - tickIndex N>0 → IDLE_TIPS[(N - 1) % IDLE_TIPS.length].
 *
 * The runtime keeps tickIndex at 0 whenever the user is active or
 * `state.statusMessage` is non-empty, so the tip only appears during true
 * idle stretches.
 */

export const IDLE_TIPS: string[] = [
  'press : to search every command',
  'g h returns home from anywhere',
  '/ filters the active view',
  'press ? to see the full keymap',
  's cycles sort modes in branches and tags',
  'gz opens the stash view',
  '< or esc walks the navigation stack back',
]

/**
 * Threshold (in ms) of idle time before the first tip appears. Picked at 10s
 * to match the spec in #756 — long enough that an active user never sees
 * one, short enough to be useful when the user genuinely paused.
 */
export const IDLE_TIPS_GRACE_MS = 10_000

/** Cadence between subsequent tips in ms. */
export const IDLE_TIPS_INTERVAL_MS = 8_000

export function pickIdleTip(tickIndex: number): string | undefined {
  if (tickIndex <= 0) return undefined
  if (IDLE_TIPS.length === 0) return undefined
  return IDLE_TIPS[(tickIndex - 1) % IDLE_TIPS.length]
}
