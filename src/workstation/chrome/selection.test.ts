import { selectionRowProps } from './selection'
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
