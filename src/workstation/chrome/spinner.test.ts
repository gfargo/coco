import { ASCII_SPINNER_FRAMES, inlineSpinnerGlyph, pickSpinnerFrame, pickThemedSpinnerFrame, SPINNER_FRAMES } from './spinner'

describe('pickThemedSpinnerFrame', () => {
  it('cycles the braille frames when ascii is false', () => {
    for (let tick = 0; tick < SPINNER_FRAMES.length; tick++) {
      expect(pickThemedSpinnerFrame(tick, false)).toBe(pickSpinnerFrame(tick))
    }
  })

  it('cycles 4 distinct ASCII frames when ascii is true', () => {
    const frames = [0, 1, 2, 3].map((tick) => pickThemedSpinnerFrame(tick, true))
    expect(new Set(frames).size).toBe(4)
    expect(frames).toEqual(ASCII_SPINNER_FRAMES)
  })

  it('wraps the ASCII cycle at 4 frames', () => {
    expect(pickThemedSpinnerFrame(4, true)).toBe(pickThemedSpinnerFrame(0, true))
    expect(pickThemedSpinnerFrame(5, true)).toBe(pickThemedSpinnerFrame(1, true))
  })

  it('clamps negative ticks to the first frame', () => {
    expect(pickThemedSpinnerFrame(-1, true)).toBe(ASCII_SPINNER_FRAMES[0])
    expect(pickThemedSpinnerFrame(-1, false)).toBe(SPINNER_FRAMES[0])
  })
})

describe('inlineSpinnerGlyph', () => {
  it('delegates to pickThemedSpinnerFrame', () => {
    expect(inlineSpinnerGlyph(2, true)).toBe(pickThemedSpinnerFrame(2, true))
    expect(inlineSpinnerGlyph(2, false)).toBe(pickThemedSpinnerFrame(2, false))
  })
})
