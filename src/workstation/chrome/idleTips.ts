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
import { en } from '../../lib/i18n/en'
import { t } from '../../lib/i18n/t'
import { forgeNouns } from './forgeNouns'

/**
 * Idle tips. Forge-specific abbreviations (PR/MR) are written as the
 * `{abbrev}` placeholder so the same table renders correctly on GitHub
 * and GitLab — `pickIdleTip` substitutes the active forge's noun
 * (`forgeNouns(provider).abbrev`) when it builds the tip.
 */
export const IDLE_TIPS: string[] = [
  t(en, 'idleTips.searchCommands'),
  t(en, 'idleTips.home'),
  t(en, 'idleTips.filterView'),
  t(en, 'idleTips.fullKeymap'),
  t(en, 'idleTips.sortCycle'),
  t(en, 'idleTips.stashView'),
  t(en, 'idleTips.navBack'),
  t(en, 'idleTips.splitCommits'),
  t(en, 'idleTips.changelog'),
  t(en, 'idleTips.createFromChangelog'),
  t(en, 'idleTips.editorDraft'),
  t(en, 'idleTips.aiCommitDraft'),
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
