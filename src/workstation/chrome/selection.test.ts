import { selectionRowProps, selectionSegmentProps } from './selection'
import { createLogInkTheme } from './theme'

describe('selectionRowProps (#2162)', () => {
  const colored = createLogInkTheme({})
  const mono = createLogInkTheme({ noColor: true })

  it('returns nothing for an unselected row', () => {
    expect(selectionRowProps(colored, false)).toEqual({})
  })

  it('uses the selection background and foreground in colour', () => {
    expect(selectionRowProps(colored, true)).toEqual({
      bold: true,
      backgroundColor: colored.colors.selection,
      color: colored.colors.selectionForeground,
    })
  })

  it('uses reverse video under NO_COLOR', () => {
    expect(selectionRowProps(mono, true)).toEqual({ bold: true, inverse: true })
  })

  it("marks an unfocused pane's cursor as secondary", () => {
    expect(selectionRowProps(colored, true, false)).toEqual({ bold: true, underline: true })
  })
})

// #2162 review: a segment colour under the focused selection background
// fought the contrast-checked selection foreground on the triage lists.
describe('selectionSegmentProps', () => {
  const colored = createLogInkTheme({})
  const mono = createLogInkTheme({ noColor: true })

  it('yields to the row on the focused selection background', () => {
    expect(selectionSegmentProps(colored, true, true, colored.colors.accent)).toEqual({})
    expect(selectionSegmentProps(colored, true, true, undefined, { alwaysDim: true })).toEqual({})
  })

  it('keeps its colour, dimmed, off the cursor row', () => {
    expect(selectionSegmentProps(colored, false, true, colored.colors.accent)).toEqual({ color: colored.colors.accent, dimColor: true })
  })

  it('keeps its colour on an unfocused cursor row, which has no background', () => {
    expect(selectionSegmentProps(colored, true, false, colored.colors.accent)).toEqual({ color: colored.colors.accent, dimColor: false })
  })

  it('drops colour under NO_COLOR', () => {
    expect(selectionSegmentProps(mono, true, true, mono.colors.accent)).toEqual({ color: undefined, dimColor: false })
  })
})
