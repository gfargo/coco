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
  /**
   * `silent` suppresses all non-error output (status lines, spinners, timers).
   * Kept for backward-compatibility; internally treated identically to `quiet`.
   * Prefer `quiet` for new code.
   */
  silent?: boolean
  /**
   * `quiet` suppresses non-error status output (banners, spinners, log lines)
   * while leaving `error()` calls unaffected.  This is what `--quiet` and
   * non-interactive mode should use — the intent is "less chrome", not
   * "silence everything including failures".
   */
  quiet?: boolean
}

/** Returns true when status output should be suppressed (silent OR quiet). */
function isMuted(config: Config | undefined): boolean {
  return !!(config?.silent || config?.quiet)
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
    if (isMuted(this.config)) {
      return this
    }
    let outputMessage = message

    if (options.color) {
      outputMessage = chalk[options.color](outputMessage)
    }

    console.log(outputMessage)

    return this
  }

  /**
   * Always writes to stderr, regardless of `silent` or `quiet`.
   * Use this for error messages that must reach the user even when status
   * output is suppressed.
   */
  public error(message: string, options: LoggerOptions = { color: 'red' }): Logger {
    let outputMessage = message

    if (options.color) {
      outputMessage = chalk[options.color](outputMessage)
    }

    process.stderr.write(outputMessage + '\n')

    return this
  }

  public verbose(message: string, options: LoggerOptions = {}): Logger {
    if (!this.config?.verbose || isMuted(this.config)) {
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
    if (!this.config?.verbose || !this.timerStart || isMuted(this.config)) {
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
    if (isMuted(this.config)) {
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
    if (isMuted(this.config)) {
      return this
    }
    const spinnerMessage = options?.color ? chalk[options.color](message) : message
    this.spinner?.[options.mode || 'succeed'](spinnerMessage)
    this.spinner = null

    return this
  }

  /**
   * Stops an active spinner without rendering any final message.
   * Called before writing error output to avoid interleaving spinner
   * control characters with error lines.
   */
  public stopSpinnerIfActive(): Logger {
    if (this.spinner) {
      this.spinner.stop()
      this.spinner = null
    }
    return this
  }
}
