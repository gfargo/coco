import { PassThrough } from 'stream'
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

  it('transliterates known glyphs via the reverse lookup', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    wrapped.write('done…')
    expect(chunks.join('')).toBe('done...')
  })

  it('falls back to width-preserving `?` for unmapped characters', () => {
    const { stream, chunks } = makeStream()
    const wrapped = wrapAsciiOutputStream(stream)
    // A wide CJK character (2 cells) should become two `?`.
    wrapped.write('中')
    expect(chunks.join('')).toBe('??')
  })

  it('leaves non-string chunks (Buffers) untouched', () => {
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
})
