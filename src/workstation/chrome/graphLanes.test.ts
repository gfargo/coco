import { getLaneColor, getLanePalette } from './graphLanes'
import { createLogInkTheme } from './theme'

describe('lane palette helpers', () => {
  it('returns an empty palette when noColor is set', () => {
    const theme = createLogInkTheme({ noColor: true, env: {} })
    expect(getLanePalette(theme)).toEqual([])
    expect(getLaneColor(0, theme)).toBeUndefined()
    expect(getLaneColor(7, theme)).toBeUndefined()
  })

  it('returns the default ANSI palette under the default preset', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    const palette = getLanePalette(theme)

    expect(palette.length).toBeGreaterThanOrEqual(6)
    // Default uses ANSI named colors so 16-color terminals render them
    // faithfully without needing truecolor support.
    expect(palette[0]).toBe('cyan')
  })

  it('hashes lane ids modulo the palette size for stable color assignment', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    const palette = getLanePalette(theme)

    expect(getLaneColor(0, theme)).toBe(palette[0])
    expect(getLaneColor(palette.length, theme)).toBe(palette[0])
    expect(getLaneColor(palette.length + 1, theme)).toBe(palette[1])
  })

  it('returns hex palette for catppuccin and gruvbox under truecolor', () => {
    const truecolor = { COLORTERM: 'truecolor' }
    const catppuccin = createLogInkTheme({ preset: 'catppuccin', env: truecolor })
    expect(getLanePalette(catppuccin)[0]).toBe('#89b4fa')

    const gruvbox = createLogInkTheme({ preset: 'gruvbox', env: truecolor })
    expect(getLanePalette(gruvbox)[0]).toBe('#83a598')
  })

  it('returns undefined lane color for undefined lane id', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    expect(getLaneColor(undefined, theme)).toBeUndefined()
  })
})
