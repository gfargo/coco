/**
 * SGR mouse-sequence parsing (OSS-1608, `logTui.mouse`).
 *
 * Ink's own CSI parser (`node_modules/ink/build/input-parser.js`) already
 * recognizes SGR mouse reports as generic CSI sequences terminated by `M`/`m`
 * — it just doesn't know what to do with them, so it hands the sequence to
 * every `useInput` consumer with the leading `\x1b` stripped (see
 * `ink/build/hooks/use-input.js`'s "Strip escape prefix" step). That means
 * mouse events arrive through the SAME channel as keyboard input — no
 * separate raw `stdin.on('data', …)` listener is needed (and adding one
 * would double-consume the stream). `useInputHandler` calls `parseSgrMouse`
 * on every keystroke's `inputValue` before falling through to normal key
 * handling; a non-mouse keystroke never matches the pattern below and pays
 * only the cost of one regex test.
 *
 * Format (both press `M` and release `m`): `[<Cb;Cx;Cy(M|m)`
 *   - `Cb` — button + modifier bitfield: bits 0-1 button number (0=left,
 *     1=middle, 2=right), bit 2 (4) shift, bit 3 (8) meta/alt, bit 4 (16)
 *     ctrl, bit 6 (64) set for the scroll wheel (bits 0-1 then 0=up, 1=down).
 *   - `Cx`, `Cy` — 1-based terminal column/row (SGR encoding never
 *     overflows at column/row 223 the way the legacy X10 encoding does,
 *     which is why `terminalLifecycle` enables `?1006h` alongside `?1000h`).
 */

export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down' | 'other'
export type MouseEventKind = 'press' | 'release'

export type MouseInputEvent = {
  button: MouseButton
  kind: MouseEventKind
  /** 0-based terminal column (converted from SGR's 1-based `Cx`). */
  x: number
  /** 0-based terminal row (converted from SGR's 1-based `Cy`). */
  y: number
  shift: boolean
  alt: boolean
  ctrl: boolean
}

// Leading `\x1b` is optional — Ink strips it before the sequence reaches
// `useInput`, but accepting it too keeps this parser correct for any
// caller working with the raw, unstripped escape sequence (e.g. tests).
const SGR_MOUSE_PATTERN = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/

/**
 * Parses one SGR mouse escape sequence. Returns `null` for anything else —
 * a normal keystroke, a partial/incomplete sequence, or a malformed one —
 * so callers can treat a `null` result as "not a mouse event, handle as a
 * regular keystroke" without a separate type check.
 */
export function parseSgrMouse(sequence: string): MouseInputEvent | null {
  const match = SGR_MOUSE_PATTERN.exec(sequence)
  if (!match) {
    return null
  }

  const cb = Number(match[1])
  const cx = Number(match[2])
  const cy = Number(match[3])
  // Terminal coordinates are 1-based; 0 or missing would underflow to a
  // negative 0-based coordinate below.
  if (cx < 1 || cy < 1) {
    return null
  }

  const buttonBits = cb & 3
  const isWheel = (cb & 64) !== 0
  const button: MouseButton = isWheel
    ? buttonBits === 0
      ? 'wheel-up'
      : buttonBits === 1
        ? 'wheel-down'
        : 'other'
    : buttonBits === 0
      ? 'left'
      : buttonBits === 1
        ? 'middle'
        : buttonBits === 2
          ? 'right'
          : 'other'

  return {
    button,
    kind: match[4] === 'M' ? 'press' : 'release',
    x: cx - 1,
    y: cy - 1,
    shift: (cb & 4) !== 0,
    alt: (cb & 8) !== 0,
    ctrl: (cb & 16) !== 0,
  }
}
