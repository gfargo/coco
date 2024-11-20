import chalk, { type Color } from 'chalk'
import ora, { Ora } from 'ora'
import now from 'performance-now'
import prettyMilliseconds from 'pretty-ms'

export interface LoggerOptions {
  color?: typeof Color
}

export interface SpinnerOptions {
  mode?: undefined | 'stop' | 'succeed' | 'warn' | 'fail'
  color?: typeof Color
}

export interface Config {
  verbose?: boolean
  silent?: boolean
}

export class Logger {
  private config: Config
  private timerStart: number | undefined
  private spinner: Ora | null

  constructor(config: Config) {
    this.config = config
    this.spinner = null
  }

  public setConfig(config: Config): Logger {
    this.config = {
      ...this.config,
      ...config,
    }
    return this
  }

  public log(message: string, options: LoggerOptions = { color: 'blue' }): Logger {
    if (this.config?.silent) {
      return this
    }
    let outputMessage = message

    if (options.color) {
      outputMessage = chalk[options.color](outputMessage)
    }

    console.log(outputMessage)

    return this
  }

  public verbose(message: string, options: LoggerOptions = {}): Logger {
    if (!this.config?.verbose || this.config?.silent) {
      return this
    }

    this.log(message, options)

    return this
  }

  public startTimer(): Logger {
    this.timerStart = now()
    return this
  }

  public stopTimer(message?: string, options: LoggerOptions = { color: 'yellow' }): Logger {
    if (!this.config?.verbose || !this.timerStart || this.config?.silent) {
      return this
    }

    const elapsedTime = prettyMilliseconds(now() - this.timerStart)
    let outputMessage = message ? `${message} (⏲ ${elapsedTime})` : `⏲ ${elapsedTime}`

    if (options.color) {
      outputMessage = chalk[options.color](outputMessage)
    }

    console.log(outputMessage)

    return this
  }

  public startSpinner(
    message: string,
    options: Omit<SpinnerOptions, 'mode'> = { color: 'green' }
  ): Logger {
    if (this.config?.silent) {
      return this
    }
    const spinnerMessage = options.color ? chalk[options.color](message) : message
    this.spinner = ora(spinnerMessage).start()

    return this
  }

  public stopSpinner(
    message: string | undefined = '',
    options: SpinnerOptions = { mode: 'succeed', color: 'green' }
  ): Logger {
    if (this.config?.silent) {
      return this
    }
    const spinnerMessage = options?.color ? chalk[options.color](message) : message
    this.spinner?.[options.mode || 'succeed'](spinnerMessage)
    this.spinner = null

    return this
  }
}
