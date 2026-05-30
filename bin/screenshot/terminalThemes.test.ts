import { describe, expect, it } from '@jest/globals'

import { buildTape } from './tape'
import { findRecipe } from './recipes'
import { DEFAULT_VHS_THEME, renderSetTheme, resolveVhsTheme } from './terminalThemes'

function jsonTheme(preset: string): Record<string, string> {
  const t = resolveVhsTheme(preset)
  if (t.kind !== 'json') throw new Error(`expected json theme for ${preset}, got named`)
  return t.palette
}

describe('resolveVhsTheme', () => {
  it('falls back to the named default for presets without a custom surface', () => {
    for (const preset of ['default', 'monochrome', undefined, 'not-a-real-theme']) {
      expect(resolveVhsTheme(preset)).toEqual({ kind: 'named', name: DEFAULT_VHS_THEME })
    }
  })

  it('gives visually distinct backgrounds to distinct themes', () => {
    // The whole point of the fix: gruvbox / rose-pine / synthwave used to
    // render on the same pinned background and looked near-identical.
    const backgrounds = ['gruvbox', 'rose-pine', 'synthwave', 'nord', 'dracula'].map(
      (p) => jsonTheme(p).background,
    )
    expect(new Set(backgrounds).size).toBe(backgrounds.length)
    expect(jsonTheme('gruvbox').background).toBe('#282828')
    expect(jsonTheme('rose-pine').background).toBe('#191724')
    expect(jsonTheme('synthwave').background).toBe('#262335')
  })

  it('renders light themes on a light surface, not dark-on-dark', () => {
    for (const preset of ['github-light', 'solarized-light', 'catppuccin-latte']) {
      const bg = jsonTheme(preset).background.toLowerCase()
      // Leading hex nibble of a light background is in the upper range.
      expect(parseInt(bg.slice(1, 3), 16)).toBeGreaterThan(0x80)
    }
  })

  it('derives ANSI slots from coco preset accents so the palette stays in sync', () => {
    // gruvbox preset: gitAdded/success #b8bb26, gitDeleted/danger #fb4934.
    const gruvbox = jsonTheme('gruvbox')
    expect(gruvbox.green).toBe('#b8bb26')
    expect(gruvbox.red).toBe('#fb4934')
  })

  it('always emits valid hex in JSON palettes (never a named ANSI colour)', () => {
    for (const preset of ['gruvbox', 'dracula', 'nord', 'tokyo-night', 'flexoki']) {
      for (const value of Object.values(jsonTheme(preset))) {
        expect(value).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })
})

describe('renderSetTheme', () => {
  it('quotes named themes and inlines JSON palettes', () => {
    expect(renderSetTheme({ kind: 'named', name: 'Catppuccin Mocha' })).toBe(
      'Set Theme "Catppuccin Mocha"',
    )
    expect(renderSetTheme(resolveVhsTheme('gruvbox'))).toContain('"background":"#282828"')
  })
})

describe('buildTape theme integration', () => {
  const opts = {
    cwd: '/tmp/scenario',
    outputPng: '/tmp/out.png',
    cocoCommand: 'tsx src/index.ts',
    repoRoot: '/repo',
    nodeBinDir: '/node',
  }

  function setThemeLine(recipeName: string): string {
    const recipe = findRecipe(recipeName)
    if (!recipe) throw new Error(`missing recipe ${recipeName}`)
    const line = buildTape(recipe, opts)
      .split('\n')
      .find((l) => l.startsWith('Set Theme'))
    if (!line) throw new Error('no Set Theme line emitted')
    return line
  }

  it('resolves the preset by parsing --theme out of the command', () => {
    expect(setThemeLine('ui-history-theme-gruvbox')).toContain('"background":"#282828"')
    expect(setThemeLine('ui-history-theme-rose-pine')).toContain('"background":"#191724"')
  })

  it('keeps the named default for non-themed recipes', () => {
    expect(setThemeLine('ui-history-pr-ready')).toBe('Set Theme "Catppuccin Mocha"')
  })

  it('every ui-history-theme recipe yields a resolvable, non-empty palette', () => {
    const themeRecipes = ['nightfox', 'carbonfox', 'github-light', 'mellow', 'vesper'].map(
      (t) => `ui-history-theme-${t}`,
    )
    for (const name of themeRecipes) {
      expect(setThemeLine(name)).toMatch(/Set Theme \{.*"background".*\}/)
    }
  })
})
