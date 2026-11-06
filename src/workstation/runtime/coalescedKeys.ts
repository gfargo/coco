/**
 * Splits a stdin chunk that carries several typed keys into one entry per key.
 *
 * Ink's `useInput` delivers one callback per stdin chunk, passing a multi-char
 * chunk whole as `input`. When the terminal (or a fast typist, a remote
 * session, a test driver) delivers `gz` in one chunk, the keybinding router
 * sees the string `'gz'`, which matches no binding, and both keys are dropped.
 *
 * Only short runs of printable ASCII with no modifier or special-key flag are
 * split. Anything else keeps its single-chunk shape: escape sequences (SGR
 * mouse reports arrive as `[<…M` strings on this same channel), control and
 * meta keys, and long runs. Bracketed paste is a separate Ink channel, so a
 * real paste never reaches this path.
 */
import type { LogInkInputKey } from './inkInput'

/** Longest chunk treated as typed keys; anything longer is passed through whole. */
export const MAX_COALESCED_KEYS = 16

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/
// `[` followed by a CSI parameter byte: SGR mouse reports (`[<0;1;1M`) and
// unparsed CSI remnants. A bare `[` or `[x` typed by a user stays splittable.
const CSI_REMNANT = /^\[[<0-9;?]/

const KEY_FLAGS: ReadonlyArray<keyof LogInkInputKey> = [
  'backspace',
  'ctrl',
  'delete',
  'downArrow',
  'end',
  'escape',
  'home',
  'leftArrow',
  'meta',
  'pageDown',
  'pageUp',
  'return',
  'rightArrow',
  'tab',
  'upArrow',
]

/**
 * Returns one single-character string per typed key, or `null` when the chunk
 * must be handled as-is (a single key, a special key, an escape sequence, or
 * too long to be typing).
 */
export function splitCoalescedKeys(inputValue: string, key: LogInkInputKey): string[] | null {
  if (inputValue.length < 2 || inputValue.length > MAX_COALESCED_KEYS) {
    return null
  }
  if (!PRINTABLE_ASCII.test(inputValue) || CSI_REMNANT.test(inputValue)) {
    return null
  }
  if (KEY_FLAGS.some((flag) => key[flag])) {
    return null
  }
  return inputValue.split('')
}
