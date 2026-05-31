/**
 * Terminal palette resolution for VHS captures.
 *
 * THE PROBLEM THIS SOLVES
 * ───────────────────────
 * coco's theme presets (`THEME_PRESET_COLORS` in the workstation chrome)
 * define *foreground* accents only — there is no background. coco paints
 * coloured text onto whatever terminal background the user already has.
 *
 * The capture pipeline used to pin the VHS terminal to a single theme
 * ("Catppuccin Mocha") for determinism, which meant every `--theme`
 * screenshot rendered gruvbox / rose-pine / synthwave foreground colours
 * on the *same* Catppuccin navy background. The themes came out looking
 * nearly identical — the marketing theme gallery undersold 30 distinct
 * palettes as 30 recolours of one.
 *
 * THE FIX
 * ───────
 * For each preset we pair coco's accents with the canonical *surface*
 * (background / foreground / cursor / selection) that the theme is known
 * for. The ANSI 0-15 slots are derived from coco's own preset colours so
 * the terminal palette stays in sync with the app — we only hand-author
 * the four surface values coco itself doesn't carry.
 *
 * This is the standard convention for TUI screenshots: the app's theme is
 * shown paired with the matching terminal theme, exactly as a user who
 * picked that palette would run it.
 */

import { THEME_PRESET_COLORS } from '../../src/workstation/chrome/theme'
import { presetUsesTrueColor } from '../../src/workstation/chrome/colorSupport'

/**
 * The four surface values coco's foreground-only presets don't define.
 * Backgrounds are the dominant lever for making a theme recognisable;
 * the canonical values below are the published backgrounds for each
 * palette. Light themes carry a light bg + dark fg so they don't render
 * as dark-on-dark mush.
 */
type Surface = { bg: string; fg: string; cursor: string; selection: string }

const TERMINAL_SURFACES: Record<string, Surface> = {
  catppuccin: { bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70' },
  gruvbox: { bg: '#282828', fg: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945' },
  dracula: { bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a' },
  nord: { bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e' },
  'solarized-dark': { bg: '#002b36', fg: '#93a1a1', cursor: '#93a1a1', selection: '#073642' },
  'tokyo-night': { bg: '#1a1b26', fg: '#c0caf5', cursor: '#c0caf5', selection: '#283457' },
  'one-dark': { bg: '#282c34', fg: '#abb2bf', cursor: '#abb2bf', selection: '#3e4451' },
  'rose-pine': { bg: '#191724', fg: '#e0def4', cursor: '#e0def4', selection: '#403d52' },
  kanagawa: { bg: '#1f1f28', fg: '#dcd7ba', cursor: '#c8c093', selection: '#2d4f67' },
  everforest: { bg: '#2d353b', fg: '#d3c6aa', cursor: '#d3c6aa', selection: '#475258' },
  monokai: { bg: '#272822', fg: '#f8f8f2', cursor: '#f8f8f0', selection: '#49483e' },
  synthwave: { bg: '#262335', fg: '#f8f8f2', cursor: '#f97e72', selection: '#463465' },
  'ayu-dark': { bg: '#0b0e14', fg: '#bfbdb6', cursor: '#e6b450', selection: '#1d2433' },
  palenight: { bg: '#292d3e', fg: '#a6accd', cursor: '#ffcc00', selection: '#444267' },
  'github-dark': { bg: '#0d1117', fg: '#c9d1d9', cursor: '#c9d1d9', selection: '#163356' },
  horizon: { bg: '#1c1e26', fg: '#d5d8da', cursor: '#e95678', selection: '#2e303e' },
  nightfox: { bg: '#192330', fg: '#cdcecf', cursor: '#cdcecf', selection: '#2b3b51' },
  carbonfox: { bg: '#161616', fg: '#f2f4f8', cursor: '#f2f4f8', selection: '#2a2a2a' },
  'tokyonight-storm': { bg: '#24283b', fg: '#c0caf5', cursor: '#c0caf5', selection: '#2e3c64' },
  'catppuccin-latte': { bg: '#eff1f5', fg: '#4c4f69', cursor: '#dc8a78', selection: '#acb0be' },
  'solarized-light': { bg: '#fdf6e3', fg: '#657b83', cursor: '#586e75', selection: '#eee8d5' },
  'github-light': { bg: '#ffffff', fg: '#24292f', cursor: '#24292f', selection: '#b6e3ff' },
  iceberg: { bg: '#161821', fg: '#c6c8d1', cursor: '#c6c8d1', selection: '#272c42' },
  'material-ocean': { bg: '#0f111a', fg: '#8f93a2', cursor: '#ffcc00', selection: '#1f2233' },
  moonlight: { bg: '#212337', fg: '#c8d3f5', cursor: '#c8d3f5', selection: '#2f334d' },
  poimandres: { bg: '#1b1e28', fg: '#a6accd', cursor: '#a6accd', selection: '#303340' },
  'vitesse-dark': { bg: '#121212', fg: '#dbd7ca', cursor: '#dbd7ca', selection: '#313131' },
  vesper: { bg: '#101010', fg: '#ffffff', cursor: '#ffc799', selection: '#232323' },
  flexoki: { bg: '#100f0f', fg: '#cecdc3', cursor: '#cecdc3', selection: '#282726' },
  mellow: { bg: '#161617', fg: '#c9c7cd', cursor: '#c9c7cd', selection: '#2a2a2d' },
  'night-owl': { bg: '#011627', fg: '#d6deeb', cursor: '#80a4c2', selection: '#1d3b53' },
  cobalt2: { bg: '#193549', fg: '#ffffff', cursor: '#ffc600', selection: '#0d3a58' },
  'oceanic-next': { bg: '#1b2b34', fg: '#cdd3de', cursor: '#c0c5ce', selection: '#4f5b66' },
  'catppuccin-macchiato': { bg: '#24273a', fg: '#cad3f5', cursor: '#f4dbd6', selection: '#494d64' },
  'gruvbox-light': { bg: '#fbf1c7', fg: '#3c3836', cursor: '#3c3836', selection: '#ebdbb2' },
  'tokyo-night-day': { bg: '#e1e2e7', fg: '#3760bf', cursor: '#3760bf', selection: '#b7c1e3' },
  'one-light': { bg: '#fafafa', fg: '#383a42', cursor: '#383a42', selection: '#e5e5e6' },
  'ayu-light': { bg: '#fafafa', fg: '#5c6166', cursor: '#ff9940', selection: '#d1e4f4' },
  'rose-pine-dawn': { bg: '#faf4ed', fg: '#575279', cursor: '#575279', selection: '#dfdad9' },
  'everforest-light': { bg: '#fdf6e3', fg: '#5c6a72', cursor: '#5c6a72', selection: '#edeada' },
  'vitesse-light': { bg: '#ffffff', fg: '#393a34', cursor: '#393a34', selection: '#eaeaeb' },
  dayfox: { bg: '#f6f2ee', fg: '#352c24', cursor: '#352c24', selection: '#e7d2be' },
  'night-owl-light': { bg: '#fbfbfb', fg: '#403f53', cursor: '#403f53', selection: '#e4e8f0' },
  'flexoki-light': { bg: '#fffcf0', fg: '#100f0f', cursor: '#100f0f', selection: '#e6e4d9' },
  'material-lighter': { bg: '#fafafa', fg: '#546e7a', cursor: '#272727', selection: '#d3e1e8' },
  'papercolor-light': { bg: '#eeeeee', fg: '#444444', cursor: '#444444', selection: '#d0d0d0' },
  'modus-operandi': { bg: '#ffffff', fg: '#000000', cursor: '#000000', selection: '#c0deff' },
  'quiet-light': { bg: '#f5f5f5', fg: '#333333', cursor: '#333333', selection: '#c9d0d9' },
}

/**
 * VHS's named-theme fallback for presets without a custom surface map
 * (default, monochrome) — keeps their current, already-good look.
 */
export const DEFAULT_VHS_THEME = 'Catppuccin Mocha'

/**
 * A `Set Theme` argument: either a VHS named theme (rendered as
 * `Set Theme "<name>"`) or a full xterm palette (rendered as
 * `Set Theme { …json… }`).
 */
export type VhsTheme = { kind: 'named'; name: string } | { kind: 'json'; palette: Record<string, string> }

/** Pick the first defined colour, falling back to a literal default. */
function pick(fallback: string, ...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    // Only hex values are valid in a VHS JSON palette; named colours
    // (e.g. 'green') belong to non-truecolor presets that never reach
    // this path, but guard anyway.
    if (c && c.startsWith('#')) return c
  }
  return fallback
}

/**
 * Resolve the VHS terminal theme for a coco preset. Truecolor presets
 * with a known surface get a full JSON palette built from that surface
 * plus coco's own accent hexes; everything else falls back to the named
 * default so its look is unchanged.
 */
export function resolveVhsTheme(preset: string | undefined): VhsTheme {
  const key = preset ?? 'default'
  const surface = TERMINAL_SURFACES[key]
  if (!surface || !presetUsesTrueColor(key)) {
    return { kind: 'named', name: DEFAULT_VHS_THEME }
  }

  const c = THEME_PRESET_COLORS[key as keyof typeof THEME_PRESET_COLORS] ?? {}
  const red = pick('#f38ba8', c.danger, c.gitDeleted)
  const green = pick('#a6e3a1', c.success, c.gitAdded)
  const yellow = pick('#f9e2af', c.warning, c.gitModified)
  const blue = pick('#89b4fa', c.info)
  const magenta = pick('#cba6f7', c.accent)
  const cyan = pick('#94e2d5', c.focusBorder, c.accent)
  const dim = pick(surface.selection, c.muted, c.border)

  return {
    kind: 'json',
    palette: {
      background: surface.bg,
      foreground: surface.fg,
      cursor: surface.cursor,
      selection: surface.selection,
      black: surface.bg,
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white: surface.fg,
      brightBlack: dim,
      brightRed: red,
      brightGreen: green,
      brightYellow: yellow,
      brightBlue: blue,
      brightMagenta: magenta,
      brightCyan: cyan,
      brightWhite: surface.fg,
    },
  }
}

/** Render a resolved theme as a VHS `Set Theme` directive line. */
export function renderSetTheme(theme: VhsTheme): string {
  if (theme.kind === 'named') return `Set Theme "${theme.name}"`
  return `Set Theme ${JSON.stringify(theme.palette)}`
}
