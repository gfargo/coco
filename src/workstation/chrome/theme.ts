import { ColorEnv, getColorLevel, presetUsesTrueColor, readableForegroundFor } from './colorSupport'

export type LogInkBorderStyle = 'round' | 'single' | 'classic'
export type LogInkThemePreset = 'default' | 'monochrome' | 'catppuccin' | 'gruvbox' | 'dracula' | 'nord' | 'solarized-dark' | 'tokyo-night' | 'one-dark' | 'rose-pine' | 'kanagawa' | 'everforest' | 'monokai' | 'synthwave' | 'ayu-dark' | 'palenight' | 'github-dark' | 'horizon' | 'nightfox' | 'carbonfox' | 'tokyonight-storm' | 'catppuccin-latte' | 'solarized-light' | 'github-light' | 'iceberg' | 'material-ocean' | 'moonlight' | 'poimandres' | 'vitesse-dark' | 'vesper' | 'flexoki' | 'mellow' | 'night-owl' | 'cobalt2' | 'oceanic-next' | 'catppuccin-macchiato' | 'gruvbox-light' | 'tokyo-night-day' | 'one-light' | 'ayu-light' | 'rose-pine-dawn' | 'everforest-light' | 'vitesse-light' | 'dayfox' | 'night-owl-light' | 'flexoki-light' | 'material-lighter' | 'papercolor-light' | 'modus-operandi' | 'quiet-light'

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

export const THEME_PRESET_COLORS: Record<Exclude<LogInkThemePreset, 'monochrome'>, LogInkThemeColors> = {
  default: {
    accent: 'cyan',
    border: 'gray',
    danger: 'red',
    focusBorder: 'cyan',
    gitAdded: 'green',
    gitDeleted: 'red',
    gitModified: 'yellow',
    info: 'blue',
    muted: 'gray',
    selection: '#1a3a4a',
    success: 'green',
    warning: 'yellow',
  },
  catppuccin: {
    accent: '#89b4fa',
    border: '#585b70',
    danger: '#f38ba8',
    focusBorder: '#89dceb',
    gitAdded: '#a6e3a1',
    gitDeleted: '#f38ba8',
    gitModified: '#f9e2af',
    info: '#89b4fa',
    muted: '#6c7086',
    selection: '#45475a',
    success: '#a6e3a1',
    warning: '#f9e2af',
  },
  gruvbox: {
    accent: '#83a598',
    border: '#665c54',
    danger: '#fb4934',
    focusBorder: '#8ec07c',
    gitAdded: '#b8bb26',
    gitDeleted: '#fb4934',
    gitModified: '#fabd2f',
    info: '#83a598',
    muted: '#928374',
    selection: '#504945',
    success: '#b8bb26',
    warning: '#fabd2f',
  },
  dracula: {
    accent: '#bd93f9',
    border: '#44475a',
    danger: '#ff5555',
    focusBorder: '#ff79c6',
    gitAdded: '#50fa7b',
    gitDeleted: '#ff5555',
    gitModified: '#f1fa8c',
    info: '#8be9fd',
    muted: '#6272a4',
    selection: '#44475a',
    success: '#50fa7b',
    warning: '#f1fa8c',
  },
  nord: {
    accent: '#88c0d0',
    border: '#3b4252',
    danger: '#bf616a',
    focusBorder: '#81a1c1',
    gitAdded: '#a3be8c',
    gitDeleted: '#bf616a',
    gitModified: '#ebcb8b',
    info: '#81a1c1',
    muted: '#4c566a',
    selection: '#3b4252',
    success: '#a3be8c',
    warning: '#ebcb8b',
  },
  'solarized-dark': {
    accent: '#268bd2',
    border: '#073642',
    danger: '#dc322f',
    focusBorder: '#2aa198',
    gitAdded: '#859900',
    gitDeleted: '#dc322f',
    gitModified: '#b58900',
    info: '#268bd2',
    muted: '#586e75',
    selection: '#073642',
    success: '#859900',
    warning: '#b58900',
  },
  'tokyo-night': {
    accent: '#7aa2f7',
    border: '#3b4261',
    danger: '#f7768e',
    focusBorder: '#7dcfff',
    gitAdded: '#9ece6a',
    gitDeleted: '#f7768e',
    gitModified: '#e0af68',
    info: '#7aa2f7',
    muted: '#565f89',
    selection: '#33467c',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  'one-dark': {
    accent: '#61afef',
    border: '#3e4452',
    danger: '#e06c75',
    focusBorder: '#56b6c2',
    gitAdded: '#98c379',
    gitDeleted: '#e06c75',
    gitModified: '#e5c07b',
    info: '#61afef',
    muted: '#5c6370',
    selection: '#3e4452',
    success: '#98c379',
    warning: '#e5c07b',
  },
  'rose-pine': {
    accent: '#c4a7e7',
    border: '#26233a',
    danger: '#eb6f92',
    focusBorder: '#9ccfd8',
    gitAdded: '#31748f',
    gitDeleted: '#eb6f92',
    gitModified: '#f6c177',
    info: '#9ccfd8',
    muted: '#6e6a86',
    selection: '#2a273f',
    success: '#31748f',
    warning: '#f6c177',
  },
  kanagawa: {
    accent: '#7e9cd8',
    border: '#2a2a37',
    danger: '#e82424',
    focusBorder: '#7fb4ca',
    gitAdded: '#76946a',
    gitDeleted: '#e82424',
    gitModified: '#dca561',
    info: '#7e9cd8',
    muted: '#727169',
    selection: '#2d4f67',
    success: '#76946a',
    warning: '#dca561',
  },
  everforest: {
    accent: '#a7c080',
    border: '#374145',
    danger: '#e67e80',
    focusBorder: '#83c092',
    gitAdded: '#a7c080',
    gitDeleted: '#e67e80',
    gitModified: '#dbbc7f',
    info: '#7fbbb3',
    muted: '#859289',
    selection: '#374145',
    success: '#a7c080',
    warning: '#dbbc7f',
  },
  monokai: {
    accent: '#66d9ef',
    border: '#49483e',
    danger: '#f92672',
    focusBorder: '#a6e22e',
    gitAdded: '#a6e22e',
    gitDeleted: '#f92672',
    gitModified: '#e6db74',
    info: '#66d9ef',
    muted: '#75715e',
    selection: '#49483e',
    success: '#a6e22e',
    warning: '#e6db74',
  },
  synthwave: {
    accent: '#f97e72',
    border: '#34294f',
    danger: '#fe4450',
    focusBorder: '#36f9f6',
    gitAdded: '#72f1b8',
    gitDeleted: '#fe4450',
    gitModified: '#fede5d',
    info: '#36f9f6',
    muted: '#848bbd',
    selection: '#34294f',
    success: '#72f1b8',
    warning: '#fede5d',
  },
  'ayu-dark': {
    accent: '#e6b450',
    border: '#11151c',
    danger: '#f07178',
    focusBorder: '#39bae6',
    gitAdded: '#7fd962',
    gitDeleted: '#f07178',
    gitModified: '#e6b450',
    info: '#39bae6',
    muted: '#565b66',
    selection: '#1a1f29',
    success: '#7fd962',
    warning: '#e6b450',
  },
  palenight: {
    accent: '#82aaff',
    border: '#3a3f58',
    danger: '#ff5370',
    focusBorder: '#89ddff',
    gitAdded: '#c3e88d',
    gitDeleted: '#ff5370',
    gitModified: '#ffcb6b',
    info: '#82aaff',
    muted: '#676e95',
    selection: '#3a3f58',
    success: '#c3e88d',
    warning: '#ffcb6b',
  },
  'github-dark': {
    accent: '#58a6ff',
    border: '#30363d',
    danger: '#f85149',
    focusBorder: '#58a6ff',
    gitAdded: '#3fb950',
    gitDeleted: '#f85149',
    gitModified: '#d29922',
    info: '#58a6ff',
    muted: '#8b949e',
    selection: '#264f78',
    success: '#3fb950',
    warning: '#d29922',
  },
  horizon: {
    accent: '#e95678',
    border: '#2e303e',
    danger: '#e95678',
    focusBorder: '#25b0bc',
    gitAdded: '#09f7a0',
    gitDeleted: '#e95678',
    gitModified: '#fab795',
    info: '#25b0bc',
    muted: '#6c6f93',
    selection: '#2e303e',
    success: '#09f7a0',
    warning: '#fab795',
  },
  nightfox: {
    accent: '#719cd6',
    border: '#2b3b51',
    danger: '#c94f6d',
    focusBorder: '#63cdcf',
    gitAdded: '#81b29a',
    gitDeleted: '#c94f6d',
    gitModified: '#dbc074',
    info: '#719cd6',
    muted: '#738091',
    selection: '#2b3b51',
    success: '#81b29a',
    warning: '#dbc074',
  },
  carbonfox: {
    accent: '#78a9ff',
    border: '#353535',
    danger: '#ee5396',
    focusBorder: '#33b1ff',
    gitAdded: '#42be65',
    gitDeleted: '#ee5396',
    gitModified: '#ffe97b',
    info: '#78a9ff',
    muted: '#7b7c7e',
    selection: '#353535',
    success: '#42be65',
    warning: '#ffe97b',
  },
  'tokyonight-storm': {
    accent: '#7aa2f7',
    border: '#2f334d',
    danger: '#f7768e',
    focusBorder: '#2ac3de',
    gitAdded: '#9ece6a',
    gitDeleted: '#f7768e',
    gitModified: '#e0af68',
    info: '#2ac3de',
    muted: '#545c7e',
    selection: '#2f334d',
    success: '#9ece6a',
    warning: '#e0af68',
  },
  'catppuccin-latte': {
    accent: '#1e66f5',
    border: '#ccd0da',
    danger: '#d20f39',
    focusBorder: '#179299',
    gitAdded: '#40a02b',
    gitDeleted: '#d20f39',
    gitModified: '#df8e1d',
    info: '#1e66f5',
    muted: '#9ca0b0',
    selection: '#ccd0da',
    success: '#40a02b',
    warning: '#df8e1d',
  },
  'solarized-light': {
    accent: '#268bd2',
    border: '#eee8d5',
    danger: '#dc322f',
    focusBorder: '#2aa198',
    gitAdded: '#859900',
    gitDeleted: '#dc322f',
    gitModified: '#b58900',
    info: '#268bd2',
    muted: '#93a1a1',
    selection: '#eee8d5',
    success: '#859900',
    warning: '#b58900',
  },
  'github-light': {
    accent: '#0969da',
    border: '#d0d7de',
    danger: '#cf222e',
    focusBorder: '#0969da',
    gitAdded: '#1a7f37',
    gitDeleted: '#cf222e',
    gitModified: '#9a6700',
    info: '#0969da',
    muted: '#656d76',
    selection: '#ddf4ff',
    success: '#1a7f37',
    warning: '#9a6700',
  },
  iceberg: {
    accent: '#84a0c6',
    border: '#1e2132',
    danger: '#e27878',
    focusBorder: '#89b8c2',
    gitAdded: '#b4be82',
    gitDeleted: '#e27878',
    gitModified: '#e2a478',
    info: '#84a0c6',
    muted: '#6b7089',
    selection: '#1e2132',
    success: '#b4be82',
    warning: '#e2a478',
  },
  'material-ocean': {
    accent: '#82aaff',
    border: '#2b2f3a',
    danger: '#f07178',
    focusBorder: '#89ddff',
    gitAdded: '#c3e88d',
    gitDeleted: '#f07178',
    gitModified: '#ffcb6b',
    info: '#82aaff',
    muted: '#464b5d',
    selection: '#2b2f3a',
    success: '#c3e88d',
    warning: '#ffcb6b',
  },
  moonlight: {
    accent: '#82aaff',
    border: '#2f334d',
    danger: '#ff757f',
    focusBorder: '#86e1fc',
    gitAdded: '#c3e88d',
    gitDeleted: '#ff757f',
    gitModified: '#ffc777',
    info: '#82aaff',
    muted: '#636da6',
    selection: '#2f334d',
    success: '#c3e88d',
    warning: '#ffc777',
  },
  poimandres: {
    accent: '#add7ff',
    border: '#1b1e28',
    danger: '#d0679d',
    focusBorder: '#5de4c7',
    gitAdded: '#5de4c7',
    gitDeleted: '#d0679d',
    gitModified: '#fffac2',
    info: '#add7ff',
    muted: '#506477',
    selection: '#1b1e28',
    success: '#5de4c7',
    warning: '#fffac2',
  },
  'vitesse-dark': {
    accent: '#4d9375',
    border: '#282828',
    danger: '#cb7676',
    focusBorder: '#4d9375',
    gitAdded: '#4d9375',
    gitDeleted: '#cb7676',
    gitModified: '#e6cc77',
    info: '#6394bf',
    muted: '#758575',
    selection: '#282828',
    success: '#4d9375',
    warning: '#e6cc77',
  },
  vesper: {
    accent: '#ffc799',
    border: '#232323',
    danger: '#f5a191',
    focusBorder: '#99ffe4',
    gitAdded: '#99ffe4',
    gitDeleted: '#f5a191',
    gitModified: '#ffc799',
    info: '#a0c4ff',
    muted: '#575757',
    selection: '#232323',
    success: '#99ffe4',
    warning: '#ffc799',
  },
  flexoki: {
    accent: '#205ea6',
    border: '#343331',
    danger: '#af3029',
    focusBorder: '#24837b',
    gitAdded: '#66800b',
    gitDeleted: '#af3029',
    gitModified: '#ad8301',
    info: '#205ea6',
    muted: '#878580',
    selection: '#343331',
    success: '#66800b',
    warning: '#ad8301',
  },
  mellow: {
    accent: '#7eb8da',
    border: '#2a2a2a',
    danger: '#f5a191',
    focusBorder: '#a3d4a0',
    gitAdded: '#a3d4a0',
    gitDeleted: '#f5a191',
    gitModified: '#f0c674',
    info: '#7eb8da',
    muted: '#6b6b6b',
    selection: '#2a2a2a',
    success: '#a3d4a0',
    warning: '#f0c674',
  },
  'night-owl': {
    accent: '#82aaff',
    border: '#1d3b53',
    danger: '#ef5350',
    focusBorder: '#7fdbca',
    gitAdded: '#addb67',
    gitDeleted: '#ef5350',
    gitModified: '#ecc48d',
    info: '#82aaff',
    muted: '#637777',
    selection: '#1d3b53',
    success: '#addb67',
    warning: '#ecc48d',
  },
  cobalt2: {
    accent: '#ffc600',
    border: '#234e6d',
    danger: '#ff628c',
    focusBorder: '#9effff',
    gitAdded: '#3ad900',
    gitDeleted: '#ff628c',
    gitModified: '#ffc600',
    info: '#9effff',
    muted: '#627e99',
    selection: '#0d3a58',
    success: '#3ad900',
    warning: '#ffc600',
  },
  'oceanic-next': {
    accent: '#6699cc',
    border: '#343d46',
    danger: '#ec5f67',
    focusBorder: '#5fb3b3',
    gitAdded: '#99c794',
    gitDeleted: '#ec5f67',
    gitModified: '#fac863',
    info: '#6699cc',
    muted: '#65737e',
    selection: '#4f5b66',
    success: '#99c794',
    warning: '#fac863',
  },
  'catppuccin-macchiato': {
    accent: '#8aadf4',
    border: '#494d64',
    danger: '#ed8796',
    focusBorder: '#91d7e3',
    gitAdded: '#a6da95',
    gitDeleted: '#ed8796',
    gitModified: '#eed49f',
    info: '#8aadf4',
    muted: '#6e738d',
    selection: '#363a4f',
    success: '#a6da95',
    warning: '#eed49f',
  },
  'gruvbox-light': {
    accent: '#076678',
    border: '#bdae93',
    danger: '#9d0006',
    focusBorder: '#427b58',
    gitAdded: '#79740e',
    gitDeleted: '#9d0006',
    gitModified: '#b57614',
    info: '#076678',
    muted: '#7c6f64',
    selection: '#ebdbb2',
    success: '#79740e',
    warning: '#b57614',
  },
  'tokyo-night-day': {
    accent: '#2e7de9',
    border: '#b7c1e3',
    danger: '#f52a65',
    focusBorder: '#007197',
    gitAdded: '#587539',
    gitDeleted: '#f52a65',
    gitModified: '#8c6c3e',
    info: '#2e7de9',
    muted: '#848cb5',
    selection: '#b7c1e3',
    success: '#587539',
    warning: '#8c6c3e',
  },
  'one-light': {
    accent: '#4078f2',
    border: '#d4d4d4',
    danger: '#e45649',
    focusBorder: '#0184bc',
    gitAdded: '#50a14f',
    gitDeleted: '#e45649',
    gitModified: '#c18401',
    info: '#4078f2',
    muted: '#a0a1a7',
    selection: '#e5e5e6',
    success: '#50a14f',
    warning: '#c18401',
  },
  'ayu-light': {
    accent: '#fa8d3e',
    border: '#e6e6e6',
    danger: '#e65050',
    focusBorder: '#4cbf99',
    gitAdded: '#6cbf43',
    gitDeleted: '#e65050',
    gitModified: '#f2ae49',
    info: '#399ee6',
    muted: '#abb0b6',
    selection: '#d1e4f4',
    success: '#6cbf43',
    warning: '#f2ae49',
  },
  'rose-pine-dawn': {
    accent: '#907aa9',
    border: '#dfdad9',
    danger: '#b4637a',
    focusBorder: '#56949f',
    gitAdded: '#286983',
    gitDeleted: '#b4637a',
    gitModified: '#ea9d34',
    info: '#56949f',
    muted: '#9893a5',
    selection: '#dfdad9',
    success: '#286983',
    warning: '#ea9d34',
  },
  'everforest-light': {
    accent: '#8da101',
    border: '#ddd8be',
    danger: '#f85552',
    focusBorder: '#35a77c',
    gitAdded: '#8da101',
    gitDeleted: '#f85552',
    gitModified: '#dfa000',
    info: '#3a94c5',
    muted: '#939f91',
    selection: '#edeada',
    success: '#8da101',
    warning: '#dfa000',
  },
  'vitesse-light': {
    accent: '#1e754f',
    border: '#e0e0e0',
    danger: '#ab5959',
    focusBorder: '#2993a3',
    gitAdded: '#1e754f',
    gitDeleted: '#ab5959',
    gitModified: '#b07d48',
    info: '#296aa3',
    muted: '#999fa6',
    selection: '#eaeaeb',
    success: '#1e754f',
    warning: '#b07d48',
  },
  dayfox: {
    accent: '#2848a9',
    border: '#e4dcd4',
    danger: '#a5222f',
    focusBorder: '#287980',
    gitAdded: '#396847',
    gitDeleted: '#a5222f',
    gitModified: '#ac5402',
    info: '#2848a9',
    muted: '#908479',
    selection: '#e7d2be',
    success: '#396847',
    warning: '#ac5402',
  },
  'night-owl-light': {
    accent: '#288ed7',
    border: '#d9d9d9',
    danger: '#d3423e',
    focusBorder: '#2aa298',
    gitAdded: '#08916a',
    gitDeleted: '#d3423e',
    gitModified: '#daaa01',
    info: '#288ed7',
    muted: '#989fb1',
    selection: '#e4e8f0',
    success: '#08916a',
    warning: '#daaa01',
  },
  'flexoki-light': {
    accent: '#205ea6',
    border: '#cecdc3',
    danger: '#af3029',
    focusBorder: '#24837b',
    gitAdded: '#66800b',
    gitDeleted: '#af3029',
    gitModified: '#ad8301',
    info: '#205ea6',
    muted: '#6f6e69',
    selection: '#e6e4d9',
    success: '#66800b',
    warning: '#ad8301',
  },
  'material-lighter': {
    accent: '#39adb5',
    border: '#e7eaec',
    danger: '#e53935',
    focusBorder: '#39adb5',
    gitAdded: '#91b859',
    gitDeleted: '#e53935',
    gitModified: '#f6a434',
    info: '#6182b8',
    muted: '#90a4ae',
    selection: '#d3e1e8',
    success: '#91b859',
    warning: '#f6a434',
  },
  'papercolor-light': {
    accent: '#0087af',
    border: '#d7d7d7',
    danger: '#af0000',
    focusBorder: '#005f87',
    gitAdded: '#008700',
    gitDeleted: '#af0000',
    gitModified: '#d75f00',
    info: '#0087af',
    muted: '#878787',
    selection: '#d0d0d0',
    success: '#008700',
    warning: '#d75f00',
  },
  'modus-operandi': {
    accent: '#0031a9',
    border: '#d7d7d7',
    danger: '#a60000',
    focusBorder: '#005e8b',
    gitAdded: '#006800',
    gitDeleted: '#a60000',
    gitModified: '#6f5500',
    info: '#0031a9',
    muted: '#595959',
    selection: '#c0deff',
    success: '#006800',
    warning: '#6f5500',
  },
  'quiet-light': {
    accent: '#4b83cd',
    border: '#e0e0e0',
    danger: '#aa3731',
    focusBorder: '#4b83cd',
    gitAdded: '#448c27',
    gitDeleted: '#aa3731',
    gitModified: '#a67d00',
    info: '#4b83cd',
    muted: '#a3a6ad',
    selection: '#c9d0d9',
    success: '#448c27',
    warning: '#a67d00',
  },
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
