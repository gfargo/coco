/**
 * OSC 8 hyperlink helpers for the Ink TUI (P5.1).
 *
 * Modern terminals (iTerm2, kitty, WezTerm, Ghostty, recent VS Code, Windows
 * Terminal, Alacritty, foot) recognise the OSC 8 escape sequence and turn
 * the wrapped text into a clickable / Cmd-clickable link. Older or
 * minimal terminals ignore the sequence — but a few of them render the
 * escape codes as raw garbage instead, so we feature-detect and fall back
 * to plain text rather than always emitting.
 *
 * Sequence:  ESC ] 8 ; ; <url> ESC \  <text>  ESC ] 8 ; ;  ESC \
 */

const ESC = '\u001b'
const OSC_PREFIX = `${ESC}]8;;`
const ST = `${ESC}\\`

export type HyperlinkEnv = {
  NO_COLOR?: string
  FORCE_HYPERLINK?: string
  TERM?: string
  TERM_PROGRAM?: string
  KITTY_WINDOW_ID?: string
  WT_SESSION?: string
  GHOSTTY_RESOURCES_DIR?: string
}

/**
 * Detect whether the host terminal will likely render OSC 8 hyperlinks.
 *
 * Conservative: only returns true for terminals that have publicly
 * confirmed support. Unknown terminals fall back to plain text — making
 * the wrap a no-op rather than risking garbage output. Set
 * `FORCE_HYPERLINK=1` to override during testing.
 */
export function supportsHyperlinks(env: HyperlinkEnv = process.env): boolean {
  if (env.FORCE_HYPERLINK) {
    return env.FORCE_HYPERLINK !== '0'
  }

  // Honor NO_COLOR for parity with our color handling — users who opt out
  // of color formatting generally want a clean plain-text output too.
  if (env.NO_COLOR) {
    return false
  }

  // kitty publishes either of these markers.
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') {
    return true
  }

  // Windows Terminal sets WT_SESSION.
  if (env.WT_SESSION) {
    return true
  }

  // Ghostty exposes its resources dir.
  if (env.GHOSTTY_RESOURCES_DIR) {
    return true
  }

  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
    case 'WezTerm':
    case 'vscode':
    case 'ghostty':
    case 'mintty':
    case 'Hyper':
      return true
    default:
      return false
  }
}

/**
 * Wrap `text` in an OSC 8 hyperlink when the host terminal supports it,
 * otherwise return the plain text unchanged. Empty / missing url falls
 * back to the plain text.
 */
export function formatHyperlink(
  text: string,
  url: string | undefined,
  env: HyperlinkEnv = process.env
): string {
  if (!url) {
    return text
  }
  if (!supportsHyperlinks(env)) {
    return text
  }
  return `${OSC_PREFIX}${url}${ST}${text}${OSC_PREFIX}${ST}`
}
