/**
 * ASCII-mode detection for the workstation TUI.
 *
 * `theme.ascii` used to flip on only for `TERM=dumb` / `TERM=vt100*`. That
 * misses the much more common case of a non-UTF-8 locale (a plain SSH
 * session, a minimal Docker image, Windows conhost without a UTF-8 code
 * page) where box-drawing / braille / arrow glyphs render as mojibake even
 * though `TERM` itself looks perfectly normal (`xterm-256color`).
 *
 * Precedence, first match wins:
 *   1. `COCO_ASCII` truthy (`1` / `true`) → ascii
 *   2. Locale (`LC_ALL` → `LC_CTYPE` → `LANG`, first *set* one wins) that
 *      does not mention UTF-8 → ascii
 *   3. `TERM=dumb` or `TERM=vt100*` → ascii
 *   4. Otherwise → not ascii
 *
 * A locale variable that is simply unset does NOT imply ascii — Windows
 * conhost, CI runners, and many Docker images have no `LANG` at all yet
 * render unicode fine. Only a *set, non-UTF-8* value counts.
 */

export type AsciiEnv = {
  LC_ALL?: string
  LC_CTYPE?: string
  LANG?: string
  TERM?: string
  COCO_ASCII?: string
}

function isUtf8Locale(value: string): boolean {
  return /utf-?8/i.test(value)
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

export function detectAsciiMode(env: AsciiEnv = process.env): boolean {
  if (isTruthyFlag(env.COCO_ASCII)) {
    return true
  }

  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG
  if (locale && !isUtf8Locale(locale)) {
    return true
  }

  const term = env.TERM
  if (term === 'dumb' || term?.startsWith('vt100')) {
    return true
  }

  return false
}
