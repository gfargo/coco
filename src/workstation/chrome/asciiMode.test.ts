import { detectAsciiMode } from './asciiMode'

describe('detectAsciiMode', () => {
  it('is false for an empty env (Windows conhost / CI with no LANG)', () => {
    expect(detectAsciiMode({})).toBe(false)
  })

  it('is false for a UTF-8 locale', () => {
    expect(detectAsciiMode({ LANG: 'en_US.UTF-8' })).toBe(false)
    expect(detectAsciiMode({ LANG: 'en_US.utf8' })).toBe(false)
  })

  it('is true for a non-UTF-8 LANG', () => {
    expect(detectAsciiMode({ LANG: 'C' })).toBe(true)
  })

  it('LC_ALL beats a UTF-8 LANG', () => {
    expect(detectAsciiMode({ LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toBe(true)
  })

  it('LC_CTYPE beats LANG', () => {
    expect(detectAsciiMode({ LC_CTYPE: 'C', LANG: 'en_US.UTF-8' })).toBe(true)
    expect(detectAsciiMode({ LC_CTYPE: 'en_US.UTF-8', LANG: 'C' })).toBe(false)
  })

  it('COCO_ASCII=1 forces ascii mode regardless of locale', () => {
    expect(detectAsciiMode({ COCO_ASCII: '1', LANG: 'en_US.UTF-8' })).toBe(true)
  })

  it('COCO_ASCII=true forces ascii mode', () => {
    expect(detectAsciiMode({ COCO_ASCII: 'true' })).toBe(true)
  })

  it('COCO_ASCII=0 does not force ascii mode', () => {
    expect(detectAsciiMode({ COCO_ASCII: '0' })).toBe(false)
  })

  it('TERM=dumb is ascii', () => {
    expect(detectAsciiMode({ TERM: 'dumb' })).toBe(true)
  })

  it('TERM=vt100* is ascii', () => {
    expect(detectAsciiMode({ TERM: 'vt100' })).toBe(true)
    expect(detectAsciiMode({ TERM: 'vt100-am' })).toBe(true)
  })

  it('a normal TERM with no locale set is not ascii', () => {
    expect(detectAsciiMode({ TERM: 'xterm-256color' })).toBe(false)
  })

  it('defaults to process.env when no env is passed', () => {
    const original = process.env.COCO_ASCII
    process.env.COCO_ASCII = '1'
    try {
      expect(detectAsciiMode()).toBe(true)
    } finally {
      if (original === undefined) delete process.env.COCO_ASCII
      else process.env.COCO_ASCII = original
    }
  })
})
