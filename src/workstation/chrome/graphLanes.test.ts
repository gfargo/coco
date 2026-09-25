import { getLaneColor, getLanePalette } from './graphLanes'
import { createLogInkTheme, getLogInkThemePresets, THEME_PRESET_COLORS } from './theme'

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

    expect(palette.length).toBeGreaterThanOrEqual(4)
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

  it('derives lane[0] from the preset\'s own accent for non-catppuccin/gruvbox hex themes', () => {
    const truecolor = { COLORTERM: 'truecolor' }
    for (const name of ['dracula', 'nord', 'tokyo-night'] as const) {
      const theme = createLogInkTheme({ preset: name, env: truecolor })
      expect(getLanePalette(theme)[0]).toBe(theme.colors.accent)
    }
  })

  it('falls back to the ANSI default palette when a hex preset downgrades', () => {
    const theme = createLogInkTheme({ preset: 'catppuccin', env: { TERM: 'xterm' } })
    expect(getLanePalette(theme)).toEqual(['cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright'])
  })

  it('falls back to the ANSI default palette when the user overrides accent with an ANSI name', () => {
    const theme = createLogInkTheme({
      colors: { accent: 'red', focusBorder: 'red', info: 'red' },
      env: { COLORTERM: 'truecolor' },
      preset: 'dracula',
    })
    expect(getLanePalette(theme)).toEqual(['cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright'])
  })

  it('honors an explicit graphLane* override', () => {
    const theme = createLogInkTheme({
      colors: { graphLane1: '#123456' },
      env: { COLORTERM: 'truecolor' },
      preset: 'dracula',
    })
    expect(getLanePalette(theme)[0]).toBe('#123456')
  })

  it.each(Object.entries(THEME_PRESET_COLORS))(
    'preset "%s" gets a well-formed lane palette under truecolor',
    (name, colors) => {
      const theme = createLogInkTheme({ preset: name as never, env: { COLORTERM: 'truecolor' } })
      const palette = getLanePalette(theme)

      expect(palette.length).toBeGreaterThanOrEqual(3)
      if (name !== 'default') {
        for (const entry of palette) {
          expect(entry).toMatch(/^#[0-9a-f]{6}$/i)
        }
      }
      expect(palette).not.toContain(colors.muted)
    }
  )

  it('exposes every registered preset via getLogInkThemePresets (sanity for the it.each above)', () => {
    expect(getLogInkThemePresets().length).toBeGreaterThan(Object.keys(THEME_PRESET_COLORS).length)
  })
})
