import { isInRange, WIDE_RANGES } from './eastAsianWidthData'

/**
 * Cell-width measurement ported from `string-width@8.2.1` (MIT, Sindre
 * Sorhus) — the algorithm Ink lays text out with. coco's own hand-rolled
 * width table (OSS-2785 / coco#2164) disagreed with Ink on VS16 emoji, ZWJ
 * sequences, flags, and skin-tone modifiers, which caused Ink to wrap rows
 * coco believed still fit. This file re-implements that algorithm directly
 * (rather than depending on the package) because `string-width` is ESM-only
 * and can't be `require`d under ts-jest/CJS on the Node 22 CI pins this repo
 * targets. `cellWidth.test.ts` checks this port against the real installed
 * package via a child-process oracle so drift is caught, not shipped.
 *
 * @see https://github.com/sindresorhus/string-width
 */

const ZWJ = '\u200D' // ZERO WIDTH JOINER

const segmenter = new Intl.Segmenter()

// `v`-flag regex literals need `target: es2024`+ to compile under this repo's
// `target: ES2020`; the `RegExp` constructor form compiles fine and runs on
// any Node >= 20.
const zeroWidthClusterRegex = new RegExp(
  '^(?:\\p{Default_Ignorable_Code_Point}|\\p{Control}|\\p{Format}|\\p{Mark}|\\p{Surrogate})+$',
  'v'
)
const leadingNonPrintingRegex = new RegExp(
  '^[\\p{Default_Ignorable_Code_Point}\\p{Control}\\p{Format}\\p{Mark}\\p{Surrogate}]+',
  'v'
)
const rgiEmojiRegex = new RegExp('^\\p{RGI_Emoji}$', 'v')
const unqualifiedKeycapRegex = /^[\d#*]\u20E3$/ // trailing COMBINING ENCLOSING KEYCAP
const extendedPictographicRegex = /\p{Extended_Pictographic}/gu

// Printable ASCII needs no segmenter/regex/EAW lookup — width equals length.
const asciiFastPathRegex = /^[ -~]*$/

function isDoubleWidthNonRgiEmojiSequence(segment: string): boolean {
  // Real emoji clusters are < 30 chars; guard against pathological input.
  if (segment.length > 50) {
    return false
  }

  if (unqualifiedKeycapRegex.test(segment)) {
    return true
  }

  if (segment.includes(ZWJ)) {
    const pictographics = segment.match(extendedPictographicRegex)
    return pictographics !== null && pictographics.length >= 2
  }

  return false
}

function baseVisible(segment: string): string {
  return segment.replace(leadingNonPrintingRegex, '')
}

function isZeroWidthCluster(segment: string): boolean {
  return zeroWidthClusterRegex.test(segment)
}

function isHangulLeadingJamo(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0xa960 && codePoint <= 0xa97c)
  )
}

function isHangulVowelJamo(codePoint: number): boolean {
  return (
    (codePoint >= 0x1160 && codePoint <= 0x11a7) || (codePoint >= 0xd7b0 && codePoint <= 0xd7c6)
  )
}

function isHangulTrailingJamo(codePoint: number): boolean {
  return (
    (codePoint >= 0x11a8 && codePoint <= 0x11ff) || (codePoint >= 0xd7cb && codePoint <= 0xd7fb)
  )
}

function isHangulJamo(codePoint: number): boolean {
  return (
    isHangulLeadingJamo(codePoint) || isHangulVowelJamo(codePoint) || isHangulTrailingJamo(codePoint)
  )
}

function codePointWidth(codePoint: number): number {
  return isInRange(WIDE_RANGES, codePoint) ? 2 : 1
}

function hangulClusterWidth(visibleSegment: string): number | undefined {
  const codePoints: number[] = []

  for (const character of visibleSegment) {
    if (zeroWidthClusterRegex.test(character)) {
      continue
    }
    codePoints.push(character.codePointAt(0) ?? 0)
  }

  if (codePoints.length === 0) {
    return undefined
  }

  let width = 0

  for (let index = 0; index < codePoints.length; index++) {
    const codePoint = codePoints[index]
    if (!isHangulJamo(codePoint)) {
      if (width === 0) {
        return undefined
      }

      for (let remaining = index; remaining < codePoints.length; remaining++) {
        width += codePointWidth(codePoints[remaining])
      }

      return width
    }

    if (isHangulLeadingJamo(codePoint) && isHangulVowelJamo(codePoints[index + 1])) {
      width += 2
      index += isHangulTrailingJamo(codePoints[index + 2]) ? 2 : 1
      continue
    }

    width += codePointWidth(codePoint)
  }

  return width
}

function trailingHalfwidthWidth(visibleSegment: string): number {
  let extra = 0
  let first = true

  for (const character of visibleSegment) {
    if (first) {
      first = false
      continue
    }

    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint >= 0xff00 && codePoint <= 0xffef) {
      extra += codePointWidth(codePoint)
    }
  }

  return extra
}

/** Split `value` into the grapheme clusters a terminal renders as one unit. */
export function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (entry) => entry.segment)
}

function clusterWidth(segment: string): number {
  if (isZeroWidthCluster(segment)) {
    return 0
  }

  if (rgiEmojiRegex.test(segment) || isDoubleWidthNonRgiEmojiSequence(segment)) {
    return 2
  }

  const visibleSegment = baseVisible(segment)
  const hangulWidth = hangulClusterWidth(visibleSegment)
  if (hangulWidth !== undefined) {
    return hangulWidth
  }

  const codePoint = visibleSegment.codePointAt(0)
  if (codePoint === undefined) {
    return 0
  }

  return codePointWidth(codePoint) + trailingHalfwidthWidth(visibleSegment)
}

/** Visual width, in terminal cells, of `value` — matches Ink's `string-width` layout. */
export function cellWidth(value: string): number {
  if (value.length === 0) {
    return 0
  }

  if (asciiFastPathRegex.test(value)) {
    return value.length
  }

  let width = 0
  for (const { segment } of segmenter.segment(value)) {
    width += clusterWidth(segment)
  }

  return width
}
