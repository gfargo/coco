import { Config } from '../lib/config/types'

export interface BaseArgvOptions {
  interactive: boolean
  verbose: boolean
  version: boolean
  help: boolean
  /**
   * Repository directory to operate against. When set, the command
   * chdir's to this path before loading config / opening a git
   * instance, so every downstream read (config lookup, simple-git
   * baseDir, commitlint discovery, etc.) sees the same root.
   *
   * `--cwd` is an alias.
   *
   * Inherited by every coco subcommand so scripts / editor wrappers
   * / scenario tests can target arbitrary repos without `cd`-ing
   * first. Defaults to `process.cwd()` when omitted (unchanged
   * behavior for users who launch via the regular `cd && coco ...`
   * path).
   */
  repo?: string
  /** Global `--quiet` (`-q`): silence coco's status chrome. Results still print. */
  quiet?: boolean
  /** Global `--json`: emit machine-readable JSON on supported commands. */
  json?: boolean
}

export interface BaseCommandOptions extends BaseArgvOptions {}

export { Config }
