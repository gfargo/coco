export type LogInkBorderStyle = 'round' | 'single' | 'classic'

export type LogInkTheme = {
  noColor: boolean
  ascii: boolean
  borderStyle: LogInkBorderStyle
  colors: {
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
}

export type CreateLogInkThemeOptions = {
  noColor?: boolean
  ascii?: boolean
  term?: string
}

function shouldUseAscii(term: string | undefined): boolean {
  if (!term) {
    return false
  }

  return term === 'dumb' || term.startsWith('vt100')
}

export function createLogInkTheme(options: CreateLogInkThemeOptions = {}): LogInkTheme {
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR)
  const ascii = options.ascii ?? shouldUseAscii(options.term ?? process.env.TERM)

  return {
    noColor,
    ascii,
    borderStyle: ascii ? 'classic' : 'round',
    colors: noColor
      ? {}
      : {
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
  }
}
