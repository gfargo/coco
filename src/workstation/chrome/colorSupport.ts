/**
 * Explicit color-level detection for the Ink TUI (P5.2).
 *
 * Chalk already approximates hex colors when the terminal can't render
 * truecolor — but we want an explicit signal so the catppuccin / gruvbox
 * presets (which use hex) can fall back to the ANSI-named `default` preset
 * cleanly on minimal SSH sessions, instead of relying on chalk's
 * heuristics. Users who set `NO_COLOR` or pick the `monochrome` preset
 * still get the manual override.
 *
 * Levels (matching the chalk taxonomy):
 *   - 'mono'      → no ANSI escapes at all (NO_COLOR / TERM=dumb)
 *   - '16'        → standard 16-color ANSI palette
 *   - '256'       → xterm-256color
 *   - 'truecolor' → 24-bit RGB (COLORTERM=truecolor or known terminals)
 */

export type ColorLevel = 'mono' | '16' | '256' | 'truecolor'

export type ColorEnv = {
  NO_COLOR?: string
  FORCE_COLOR?: string
  COLORTERM?: string
  TERM?: string
  TERM_PROGRAM?: string
  KITTY_WINDOW_ID?: string
  WT_SESSION?: string
}

export function getColorLevel(env: ColorEnv = process.env): ColorLevel {
  if (env.NO_COLOR) return 'mono'

  switch (env.FORCE_COLOR) {
    case '0':
      return 'mono'
    case '1':
      return '16'
    case '2':
      return '256'
    case '3':
      return 'truecolor'
  }

  const colorterm = env.COLORTERM?.toLowerCase()
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    return 'truecolor'
  }

  // Modern terminal emulators that publicly advertise truecolor support.
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') {
    return 'truecolor'
  }
  if (env.WT_SESSION) {
    return 'truecolor'
  }
  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
    case 'WezTerm':
    case 'vscode':
    case 'ghostty':
    case 'Hyper':
      return 'truecolor'
  }

  if (env.TERM === 'dumb') return 'mono'
  if (env.TERM?.includes('256color')) return '256'

  return '16'
}

const TRUECOLOR_PRESETS = new Set<string>(['catppuccin', 'gruvbox', 'dracula', 'nord', 'solarized-dark', 'tokyo-night', 'one-dark', 'rose-pine', 'kanagawa', 'everforest', 'monokai', 'synthwave', 'ayu-dark', 'palenight', 'github-dark', 'horizon', 'nightfox', 'carbonfox', 'tokyonight-storm', 'catppuccin-latte', 'solarized-light', 'github-light', 'iceberg', 'material-ocean', 'moonlight', 'poimandres', 'vitesse-dark', 'vesper', 'flexoki', 'mellow', 'night-owl', 'cobalt2', 'oceanic-next', 'catppuccin-macchiato', 'gruvbox-light', 'tokyo-night-day', 'one-light', 'ayu-light', 'rose-pine-dawn', 'everforest-light', 'vitesse-light', 'dayfox', 'night-owl-light', 'flexoki-light', 'material-lighter', 'papercolor-light', 'modus-operandi', 'quiet-light'])

/**
 * `true` when the named preset relies on hex colors that look best under
 * 24-bit RGB. Used by `createLogInkTheme` to decide whether to downgrade
 * to the ANSI-named `default` palette on lower-capability terminals.
 */
export function presetUsesTrueColor(preset: string | undefined): boolean {
  return preset !== undefined && TRUECOLOR_PRESETS.has(preset)
}
