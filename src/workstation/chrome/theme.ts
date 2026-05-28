import { ColorEnv, getColorLevel, presetUsesTrueColor } from './colorSupport'

export type LogInkBorderStyle = 'round' | 'single' | 'classic'
export type LogInkThemePreset = 'default' | 'monochrome' | 'catppuccin' | 'gruvbox' | 'dracula' | 'nord' | 'solarized-dark' | 'tokyo-night' | 'one-dark' | 'rose-pine' | 'kanagawa' | 'everforest' | 'monokai' | 'synthwave' | 'ayu-dark' | 'palenight' | 'github-dark' | 'horizon'

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
  success?: string
  warning?: string
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

const THEME_PRESET_COLORS: Record<Exclude<LogInkThemePreset, 'monochrome'>, LogInkThemeColors> = {
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
    selection: 'cyan',
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
      ...options.colors,
    }

  return {
    noColor,
    ascii,
    borderStyle: options.borderStyle || (ascii ? 'classic' : 'round'),
    colors,
  }
}
