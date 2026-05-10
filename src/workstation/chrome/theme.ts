import { ColorEnv, getColorLevel, presetUsesTrueColor } from './colorSupport'

export type LogInkBorderStyle = 'round' | 'single' | 'classic'
export type LogInkThemePreset = 'default' | 'monochrome' | 'catppuccin' | 'gruvbox'

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
