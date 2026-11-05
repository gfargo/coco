/**
 * Delayed loading text (#2166). A fast load used to flash "Loading branches…"
 * for a frame or two on every refresh. Loading text is now blank until a
 * loading *episode* has lasted {@link LOADING_TEXT_DELAY_MS}.
 *
 * An episode is a run of consecutive renders in which some surface asked for
 * loading text. It starts on the first such render and ends on the first
 * commit where nobody asked. The root settles it after every commit (see
 * `useLoadingTextDelay`), which is also how the 200ms re-render gets
 * scheduled, so this module needs no clock of its own beyond `now`.
 *
 * Process-wide state, like `setAsciiDialect` in `chrome/text.ts`: the ~30
 * call sites that print loading text are pure render functions with nowhere to
 * thread a flag through. It is off by default, so tests and non-TUI callers
 * always see the text immediately.
 */

/** How long a loading episode must last before its text appears. */
export const LOADING_TEXT_DELAY_MS = 200

let delayEnabled = false
let episodeStartedAt: number | undefined
let requestedThisRender = false

/** Turn the delay on (the TUI root does) or off (the default). Resets the episode. */
export function setLoadingDelayEnabled(enabled: boolean): void {
  delayEnabled = enabled
  episodeStartedAt = undefined
  requestedThisRender = false
}

/**
 * Called by every loading-text producer. Records that loading text was wanted
 * this render and says whether it may be shown yet.
 */
export function shouldShowLoadingText(now: number = Date.now()): boolean {
  if (!delayEnabled) return true
  requestedThisRender = true
  return episodeStartedAt !== undefined && now - episodeStartedAt >= LOADING_TEXT_DELAY_MS
}

export type LoadingEpisodeSettlement = {
  /** Loading text was requested in the render that just committed. */
  requested: boolean
  /** Milliseconds until the text becomes visible; 0 when it already is. */
  remainingMs: number
}

/**
 * Run after each commit. Starts an episode on the first render that asked for
 * loading text, ends it on the first that did not, and reports how long until
 * the text may show so the caller can schedule exactly one re-render.
 */
export function settleLoadingEpisode(now: number = Date.now()): LoadingEpisodeSettlement {
  const requested = requestedThisRender
  requestedThisRender = false
  if (!delayEnabled || !requested) {
    episodeStartedAt = undefined
    return { requested: false, remainingMs: 0 }
  }
  if (episodeStartedAt === undefined) episodeStartedAt = now
  return { requested: true, remainingMs: Math.max(0, LOADING_TEXT_DELAY_MS - (now - episodeStartedAt)) }
}
