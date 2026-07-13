import { ColorEnv, getColorLevel, presetUsesTrueColor, readableForegroundFor } from './colorSupport'
import { THEME_PRESET_COLORS } from './themePresets'

export { THEME_PRESET_COLORS }

export type LogInkBorderStyle = 'round' | 'single' | 'classic'
export type LogInkThemePreset = 'default' | 'monochrome' | 'catppuccin' | 'gruvbox' | 'dracula' | 'nord' | 'solarized-dark' | 'tokyo-night' | 'one-dark' | 'rose-pine' | 'kanagawa' | 'everforest' | 'monokai' | 'synthwave' | 'ayu-dark' | 'palenight' | 'github-dark' | 'horizon' | 'nightfox' | 'carbonfox' | 'tokyonight-storm' | 'catppuccin-latte' | 'solarized-light' | 'github-light' | 'iceberg' | 'material-ocean' | 'moonlight' | 'poimandres' | 'vitesse-dark' | 'vesper' | 'flexoki' | 'mellow' | 'night-owl' | 'cobalt2' | 'oceanic-next' | 'catppuccin-macchiato' | 'gruvbox-light' | 'tokyo-night-day' | 'one-light' | 'ayu-light' | 'rose-pine-dawn' | 'everforest-light' | 'vitesse-light' | 'dayfox' | 'night-owl-light' | 'flexoki-light' | 'material-lighter' | 'papercolor-light' | 'modus-operandi' | 'quiet-light' | 'catppuccin-frappe' | 'rose-pine-moon' | 'kanagawa-dragon' | 'kanagawa-lotus' | 'nordfox' | 'duskfox' | 'terafox' | 'dawnfox' | 'ayu-mirage' | 'material-darker' | 'tokyo-night-moon' | 'gruvbox-material' | 'gruvbox-material-light' | 'modus-vivendi' | 'zenburn' | 'oxocarbon' | 'tomorrow-night' | 'monokai-pro' | 'sonokai' | 'doom-one' | 'andromeda' | 'aura' | 'cyberdream' | 'nightfly' | 'panda' | 'hyper-snazzy' | 'apprentice' | 'melange' | 'melange-light' | 'spaceduck' | 'embark' | 'bluloco-dark' | 'bluloco-light' | 'papercolor-dark' | 'base16-ocean' | 'base16-eighties' | 'everblush' | 'darcula' | 'eldritch' | 'edge-light' | 'zenbones' | 'iceberg-light' | 'github-dark-dimmed' | 'edge-dark' | 'selenized-dark' | 'selenized-black' | 'selenized-light' | 'monokai-pro-machine' | 'monokai-pro-octagon' | 'monokai-pro-ristretto' | 'monokai-pro-spectrum' | 'base16-default-dark' | 'base16-default-light' | 'tomorrow' | 'tokyodark' | 'spacemacs-dark' | 'bamboo' | 'citylights' | 'oxocarbon-light' | 'vscode-dark' | 'vscode-light' | 'xcode-dark' | 'xcode-light' | 'sublime-mariana' | 'github-dark-high-contrast' | 'noctis' | 'shades-of-purple' | 'winter-is-coming' | 'tomorrow-night-bright' | 'tomorrow-night-eighties' | 'molokai' | 'jellybeans' | 'railscasts' | 'spacegray' | 'srcery' | 'alabaster' | 'challenger-deep' | 'moonfly'

export type LogInkThemeColors = {
  accent?: string
  border?: string
  danger?: string
  focusBorder?: string
  gitAdded?: string
  gitDeleted?: string
  gitModified?: string
  info?: string
  muted?: string
  selection?: string
  /**
   * Foreground for text sitting on the `selection` background. Derived
   * automatically from `selection` (black on light, white on dark) so the
   * selected row stays readable regardless of the user's terminal default
   * foreground — but can be overridden per theme via `options.colors`.
   */
  selectionForeground?: string
  success?: string
  warning?: string
  /**
   * Optional syntax-highlight token colors for the diff view (#1117
   * follow-up). All optional: when a slot is unset the resolver
   * (`resolveSyntaxColor`) falls back to a sensible ANSI default, so
   * themes get highlighting for free and only need to define these to
   * customize. `noColor` themes skip syntax coloring entirely.
   */
  syntaxKeyword?: string
  syntaxString?: string
  syntaxComment?: string
  syntaxNumber?: string
  syntaxType?: string
  syntaxFunction?: string
  syntaxConstant?: string
  syntaxProperty?: string
}

export type LogInkThemeConfig = {
  ascii?: boolean
  borderStyle?: LogInkBorderStyle
  colors?: LogInkThemeColors
  preset?: LogInkThemePreset
}

export type LogInkTheme = {
  noColor: boolean
  ascii: boolean
  borderStyle: LogInkBorderStyle
  colors: LogInkThemeColors
}

export type CreateLogInkThemeOptions = LogInkThemeConfig & {
  noColor?: boolean
  term?: string
  /**
   * Snapshot of the env used for color-level detection (P5.2). Defaults to
   * `process.env`. Tests pass a synthetic env to keep results deterministic
   * across CI runners and developer machines.
   */
  env?: ColorEnv
}

/**
 * Ordered list of every selectable theme preset, for the `coco ui` theme
 * picker and any UI that enumerates themes. `monochrome` isn't a key in
 * `THEME_PRESET_COLORS` (it's handled via `noColor`), so it's spliced in
 * right after `default` — the two non-color baselines sit together at the
 * top, followed by the color themes in catalog order.
 */
export function getLogInkThemePresets(): LogInkThemePreset[] {
  const keys = Object.keys(THEME_PRESET_COLORS) as Exclude<LogInkThemePreset, 'monochrome'>[]
  const [first, ...rest] = keys
  return first === 'default'
    ? ['default', 'monochrome', ...rest]
    : ['monochrome', ...keys]
}

function shouldUseAscii(term: string | undefined): boolean {
  if (!term) {
    return false
  }

  return term === 'dumb' || term.startsWith('vt100')
}

export function createLogInkTheme(options: CreateLogInkThemeOptions = {}): LogInkTheme {
  const noColor = (options.noColor ?? Boolean(process.env.NO_COLOR)) ||
    options.preset === 'monochrome'
  const ascii = options.ascii ?? shouldUseAscii(options.term ?? process.env.TERM)
  const requestedPreset = options.preset && options.preset !== 'monochrome' ? options.preset : 'default'
  // P5.2 — gracefully downgrade hex presets (catppuccin / gruvbox) when
  // the host terminal can't render truecolor. Chalk approximates hex in
  // those modes anyway, but the default preset's ANSI-named palette
  // renders far more faithfully on 16-color terminals.
  const colorLevel = getColorLevel(options.env ?? process.env)
  const preset = !noColor && presetUsesTrueColor(requestedPreset) && colorLevel !== 'truecolor'
    ? 'default'
    : requestedPreset
  const colors = noColor
    ? {}
    : {
      ...THEME_PRESET_COLORS[preset],
      // Preserve the requested theme's selection background even when the
      // rest of the palette downgrades to `default`. The selection is a
      // single background color the terminal can approximate; without this,
      // a light theme inherits `default`'s dark selection (#1a3a4a) and the
      // selected row renders as a dark bar on a light background.
      ...(preset !== requestedPreset && THEME_PRESET_COLORS[requestedPreset]?.selection
        ? { selection: THEME_PRESET_COLORS[requestedPreset]!.selection }
        : {}),
      ...options.colors,
    }

  // Derive a contrasting foreground for the selected row from its own
  // selection background, unless the caller supplied one explicitly. coco
  // owns the selection background but not the terminal's default foreground,
  // so without this the selected row's text falls back to whatever the
  // user's terminal foreground is — which may not contrast with the bar at
  // all (the bug behind unreadable selected rows on many themes).
  if (!noColor && colors.selection && !colors.selectionForeground) {
    const selectionForeground = readableForegroundFor(colors.selection)
    if (selectionForeground) {
      colors.selectionForeground = selectionForeground
    }
  }

  return {
    noColor,
    ascii,
    borderStyle: options.borderStyle || (ascii ? 'classic' : 'round'),
    colors,
  }
}
