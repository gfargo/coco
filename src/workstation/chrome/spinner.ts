/**
 * Shared spinner frames for any surface that renders a loading state.
 *
 * Used by:
 *   - Split-plan overlay (`'loading'` / `'applying'` phases)
 *   - Changelog surface (`'loading'` phase)
 *   - Compose surface (AI commit draft generation)
 *   - Footer status line (transient LLM calls like create-PR body generation)
 *
 * The frames are the braille-dot cycle used by ora / ink-spinner / most other
 * Node TUI tools — 10 frames, designed to read as smooth motion at 80ms per
 * frame (~12.5 fps). The actual ticking is driven by a single shared
 * `setInterval` at the app root that pauses when no loading state is active,
 * so an idle workstation doesn't re-render every 80ms.
 */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Cadence between spinner frame transitions, in ms. 80ms gives a smooth
 * read without burning CPU. The app's spinner-tick effect uses this constant.
 */
export const SPINNER_TICK_MS = 80

/**
 * Pick the current frame for a given tick index. Wraps modulo
 * `SPINNER_FRAMES.length` so callers don't need to know the frame count.
 */
export function pickSpinnerFrame(tick: number): string {
  return SPINNER_FRAMES[Math.max(0, tick) % SPINNER_FRAMES.length]
}

/**
 * ASCII-safe spinner frames for `NO_COLOR` / ASCII terminals where the
 * braille dots either don't render or look like noise. The four-frame
 * `|/-\` cycle is the classic terminal spinner and reads as motion in
 * any encoding.
 */
export const ASCII_SPINNER_FRAMES = ['|', '/', '-', '\\']

/**
 * Inline per-item pending glyph — used in place of (or appended to) a
 * list row's status icon while that row's mutation (a delete) is in
 * flight. Braille spinner normally; the ASCII cycle under `ascii`
 * themes so the indicator survives `NO_COLOR` / dumb terminals.
 */
export function inlineSpinnerGlyph(tick: number, ascii: boolean): string {
  return ascii
    ? ASCII_SPINNER_FRAMES[Math.max(0, tick) % ASCII_SPINNER_FRAMES.length]
    : pickSpinnerFrame(tick)
}
