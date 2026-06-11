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

import type { GitProviderType } from '../../git/providerData'
import { forgeNouns } from './forgeNouns'

/**
 * Idle tips. Forge-specific abbreviations (PR/MR) are written as the
 * `{abbrev}` placeholder so the same table renders correctly on GitHub
 * and GitLab — `pickIdleTip` substitutes the active forge's noun
 * (`forgeNouns(provider).abbrev`) when it builds the tip.
 */
export const IDLE_TIPS: string[] = [
  'press : to search every command',
  'g h returns home from anywhere',
  '/ filters the active view',
  'press ? to see the full keymap',
  's cycles sort modes in branches and tags',
  'gz opens the stash view',
  '< or esc walks the navigation stack back',
  'S splits a large staged set into multiple commits',
  'L generates a changelog for the current branch',
  'C creates a {abbrev} seeded from the changelog',
  'E opens the commit draft in $EDITOR or $VISUAL',
  'I drafts an AI commit message from staged changes',
]

/**
 * Threshold (in ms) of idle time before the first tip appears. Picked at 10s
 * to match the spec in #756 — long enough that an active user never sees
 * one, short enough to be useful when the user genuinely paused.
 */
export const IDLE_TIPS_GRACE_MS = 10_000

/** Cadence between subsequent tips in ms. */
export const IDLE_TIPS_INTERVAL_MS = 8_000

export function pickIdleTip(
  tickIndex: number,
  provider?: GitProviderType
): string | undefined {
  if (tickIndex <= 0) return undefined
  if (IDLE_TIPS.length === 0) return undefined
  const tip = IDLE_TIPS[(tickIndex - 1) % IDLE_TIPS.length]
  // Substitute the forge-specific noun so GitLab repos read "MR" not "PR".
  return tip.replace('{abbrev}', forgeNouns(provider).abbrev)
}
