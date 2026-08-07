import { parseSgrMouse } from './mouseInput'

describe('parseSgrMouse', () => {
  it('parses a left-click press', () => {
    expect(parseSgrMouse('\x1b[<0;10;5M')).toEqual({
      button: 'left',
      kind: 'press',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses a left-click release', () => {
    expect(parseSgrMouse('\x1b[<0;10;5m')).toEqual({
      button: 'left',
      kind: 'release',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses the sequence with the leading escape already stripped (Ink delivery shape)', () => {
    expect(parseSgrMouse('[<0;10;5M')).toEqual({
      button: 'left',
      kind: 'press',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses middle and right buttons', () => {
    expect(parseSgrMouse('[<1;1;1M')?.button).toBe('middle')
    expect(parseSgrMouse('[<2;1;1M')?.button).toBe('right')
  })

  it('parses wheel-up and wheel-down (button codes 64/65)', () => {
    expect(parseSgrMouse('[<64;20;10M')).toMatchObject({ button: 'wheel-up', kind: 'press' })
    expect(parseSgrMouse('[<65;20;10M')).toMatchObject({ button: 'wheel-down', kind: 'press' })
  })

  it('decodes shift/alt/ctrl modifier bits', () => {
    // 0 (left) | 4 (shift) | 8 (alt) | 16 (ctrl) = 28
    expect(parseSgrMouse('[<28;1;1M')).toMatchObject({ shift: true, alt: true, ctrl: true })
  })

  it('returns null for a plain keystroke', () => {
    expect(parseSgrMouse('a')).toBeNull()
    expect(parseSgrMouse('\r')).toBeNull()
  })

  it('returns null for an incomplete/malformed sequence', () => {
    expect(parseSgrMouse('[<0;10;')).toBeNull()
    expect(parseSgrMouse('[<;;M')).toBeNull()
    expect(parseSgrMouse('')).toBeNull()
  })

  it('returns null for a non-mouse CSI sequence (e.g. an arrow key)', () => {
    expect(parseSgrMouse('[A')).toBeNull()
  })

  it('returns null for out-of-range (0-based-underflow) coordinates', () => {
    expect(parseSgrMouse('[<0;0;0M')).toBeNull()
  })
})
