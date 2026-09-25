/**
 * Output-stream backstop for `theme.ascii` mode.
 *
 * The per-surface glyph sweep (`chrome/glyphs.ts`, `pickThemedSpinnerFrame`,
 * etc.) covers the glyphs the workstation renders deliberately, but the
 * codebase has hundreds of other non-ASCII literals (commit-type colors,
 * help copy, decorative punctuation) that aren't worth threading `ascii`
 * through individually. Wrapping the actual output stream turns "we
 * think we got every call site" into a hard guarantee: nothing above
 * `0x7e` reaches a terminal that asked for ASCII.
 *
 * Bytes `\x00`-`\x7e` (which includes every ANSI/CSI escape sequence —
 * they're built entirely from ASCII bytes) pass through untouched. Any
 * character above that is transliterated via the glyph tables' reverse
 * lookup when known, ASCII-folded when it's an accented Latin letter
 * (`é`→`e`), or replaced with `?` repeated `cellWidth(ch)` times
 * otherwise — preserving the column layout Ink already computed even for
 * glyphs with no direct ASCII counterpart (CJK, emoji).
 */

import { GLYPHS, ASCII_GLYPHS } from '../../lib/ui/glyphs'
import { SPINNER_FRAMES, ASCII_SPINNER_FRAMES } from './spinner'
import { cellWidth } from './text'
import { WORKSTATION_GLYPHS, WORKSTATION_ASCII_GLYPHS } from './glyphs'

/**
 * Stream-level overrides for pairs whose ASCII form is *wider* than the
 * unicode original. The source tables are right for text measured before
 * render (`truncateCells` budgets for the 3-cell `...`); here Ink has
 * already laid the line out, so a 1→3 swap shoves everything right of it
 * past the terminal edge and breaks every box border on the row.
 */
const STREAM_WIDTH_SAFE: Record<string, string> = { '…': '.', '→': '>' }

function buildReverseGlyphMap(): Map<string, string> {
  const map = new Map<string, string>()

  const addPair = (unicode: string, ascii: string): void => {
    const override = STREAM_WIDTH_SAFE[unicode]
    if (override !== undefined) {
      map.set(unicode, override)
      return
    }
    map.set(unicode, cellWidth(ascii) === cellWidth(unicode) ? ascii : '?'.repeat(cellWidth(unicode)))
  }

  for (const key of Object.keys(GLYPHS) as (keyof typeof GLYPHS)[]) {
    addPair(GLYPHS[key], ASCII_GLYPHS[key])
  }
  for (const key of Object.keys(WORKSTATION_GLYPHS) as (keyof typeof WORKSTATION_GLYPHS)[]) {
    addPair(WORKSTATION_GLYPHS[key], WORKSTATION_ASCII_GLYPHS[key])
  }
  // Stray braille spinner frames (a surface that didn't opt into
  // `pickThemedSpinnerFrame`) collapse to a single static ASCII spinner
  // character — not animated, but legible and width-1 like the original.
  for (const frame of SPINNER_FRAMES) {
    map.set(frame, ASCII_SPINNER_FRAMES[0])
  }

  return map
}

const REVERSE_GLYPHS = buildReverseGlyphMap()

/**
 * Best-effort ASCII fold for characters with no glyph-table entry — accented
 * Latin letters in commit subjects, author names, branch names. `é`→`e`,
 * `ü`→`u`. Anything that doesn't fully fold to printable ASCII of the same
 * width (CJK, emoji, `ß`/`ø`/`æ`) returns `undefined` and falls through to
 * the `?` placeholder.
 */
function foldToAscii(character: string): string | undefined {
  const folded = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /^[\x20-\x7e]+$/.test(folded) && cellWidth(folded) === cellWidth(character)
    ? folded
    : undefined
}

function transliterate(text: string): string {
  let hasNonAscii = false
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7e) {
      hasNonAscii = true
      break
    }
  }
  if (!hasNonAscii) return text

  let out = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7e) {
      out += character
      continue
    }
    const known = REVERSE_GLYPHS.get(character)
    if (known !== undefined) {
      out += known
      continue
    }
    const folded = foldToAscii(character)
    if (folded !== undefined) {
      out += folded
      continue
    }
    out += '?'.repeat(cellWidth(character))
  }
  return out
}

/**
 * Wrap a write stream so every chunk written through it is ASCII-only.
 * Preserves the stream's identity for everything else (`.columns`,
 * `.rows`, `.on('resize')`, etc. — all of which Ink relies on) via a
 * `Proxy` that only intercepts `write`.
 */
export function wrapAsciiOutputStream(stream: NodeJS.WriteStream): NodeJS.WriteStream {
  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === 'write') {
        return (chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean => {
          const sanitized =
            typeof chunk === 'string'
              ? transliterate(chunk)
              : Buffer.isBuffer(chunk)
                ? transliterate(chunk.toString('utf8'))
                : chunk
          return (target.write as (...args: unknown[]) => boolean)(
            sanitized,
            encodingOrCallback,
            callback
          )
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as NodeJS.WriteStream
}
