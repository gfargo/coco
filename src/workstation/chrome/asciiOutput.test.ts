import { PassThrough } from 'stream'
import { GLYPHS, ASCII_GLYPHS } from '../../lib/ui/glyphs'
import { WORKSTATION_GLYPHS, WORKSTATION_ASCII_GLYPHS } from './glyphs'
import { cellWidth } from './text'
import { wrapAsciiOutputStream } from './asciiOutput'

function makeStream(): { stream: NodeJS.WriteStream; chunks: string[] } {
  const chunks: string[] = []
  const passThrough = new PassThrough()
  passThrough.on('data', (chunk) => chunks.push(chunk.toString()))
  const stream = Object.assign(passThrough, { columns: 80, rows: 24 }) as unknown as NodeJS.WriteStream
  return { stream, chunks }
}

describe('wrapAsciiOutputStream', () => {
  it('passes ASCII-only chunks through unchanged, including ANSI escapes', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    const escapeSequence = '\x1b[2J\x1b[1;1Hplain text'
    wrapped.write(escapeSequence)
    expect(chunks.join('')).toBe(escapeSequence)
  })

  it('transliterates known glyphs via the reverse lookup, preserving cell width', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write('done…')
    expect(chunks.join('')).toBe('done.')
  })

  it('transliterates arrows to a single-cell replacement', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write('go→here')
    expect(chunks.join('')).toBe('go>here')
  })

  it('ASCII-folds accented Latin letters instead of falling back to `?`', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write('café')
    expect(chunks.join('')).toBe('cafe')
    chunks.length = 0
    wrapped.write('Müller')
    expect(chunks.join('')).toBe('Muller')
  })

  it('falls back to width-preserving `?` for unmapped characters', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    // A wide CJK character (2 cells) should become two `?`.
    wrapped.write('中')
    expect(chunks.join('')).toBe('??')
  })

  it('drops zero-width characters (ZWJ emoji sequences) instead of adding stray `?`', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write('👨‍💻')
    // 👨 (2 cells) + ZWJ (0 cells) + 💻 (2 cells) → exactly 4 `?`, no more.
    expect(chunks.join('')).toBe('????')
  })

  it('transliterates non-ASCII bytes inside Buffer chunks', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write(Buffer.from('─'))
    expect(chunks.join('')).toBe('-')
  })

  it('leaves ASCII-only Buffer chunks untouched', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write(Buffer.from('raw'))
    expect(chunks.join('')).toBe('raw')
  })

  it('proxies non-write properties through to the underlying stream', () => {
    const { stream } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    expect(wrapped.columns).toBe(80)
    expect(wrapped.rows).toBe(24)
    expect(typeof wrapped.on).toBe('function')
  })

  it('every reverse-map entry is cell-width preserving', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)

    const allUnicode = [
      ...Object.values(GLYPHS),
      ...Object.values(WORKSTATION_GLYPHS),
    ]

    for (const unicode of allUnicode) {
      chunks.length = 0
      wrapped.write(unicode)
      expect(cellWidth(chunks.join(''))).toBe(cellWidth(unicode))
    }
  })
})

describe('glyph source tables (measured pre-render, not stream-safe by design)', () => {
  it('documents that `ellipsis`/`arrow` ascii forms are wider than their unicode originals', () => {
    // `truncateCells` budgets for the 3-cell `...` / 2-cell `->` explicitly,
    // so the source tables stay as-is; `asciiOutput.ts` overrides these two
    // at the stream level instead of touching the tables themselves.
    expect(cellWidth(ASCII_GLYPHS.arrow)).toBeGreaterThan(cellWidth(GLYPHS.arrow))
    expect(cellWidth(WORKSTATION_ASCII_GLYPHS.ellipsis)).toBeGreaterThan(
      cellWidth(WORKSTATION_GLYPHS.ellipsis)
    )
  })
})
