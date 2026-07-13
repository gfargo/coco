#!/usr/bin/env node
import yargs from 'yargs'
import amend from './commands/amend'
import cache from './commands/cache'
import changelog from './commands/changelog'
import commit from './commands/commit'
import configCmd from './commands/config'
import doctor from './commands/doctor'
import init from './commands/init'
import issues from './commands/issues'
import log from './commands/log'
import prCreate from './commands/prCreate'
import prs from './commands/prs'
import recap from './commands/recap'
import review from './commands/review'
import ui from './commands/ui'
import workspace from './commands/workspace'

import { AmendOptions } from './commands/amend/config'
import { CacheOptions } from './commands/cache/config'
import { ChangelogOptions } from './commands/changelog/config'
import { CommitOptions } from './commands/commit/config'
import { ConfigOptions as ConfigCmdOptions } from './commands/config/config'
import { defaultRouteHandler, type DefaultRouteArgv } from './commands/defaultRouter'
import { DoctorOptions } from './commands/doctor/config'
import { InitOptions } from './commands/init/config'
import { IssuesOptions } from './commands/issues/config'
import { LogOptions } from './commands/log/config'
import { PrCreateOptions } from './commands/prCreate/config'
import { PrsOptions } from './commands/prs/config'
import { RecapOptions } from './commands/recap/config'
import { ReviewOptions } from './commands/review/config'
import { UiOptions } from './commands/ui/config'
import { WorkspaceOptions } from './commands/workspace/config'
import { Config } from './lib/config/types'
import * as types from './lib/types'
import { handleFatalError } from './lib/ui/handleFatalError'
import commandExecutor from './lib/utils/commandExecutor'

const y = yargs()

y.scriptName('coco')

// Global `--repo <dir>` (alias `--cwd`) — every subcommand inherits
// it. The shared `applyRepoFlag` helper handlers call up-front
// chdir's to this directory + binds the simple-git instance so every
// downstream read (config lookup, simple-git baseDir, commitlint
// discovery) sees the same root. Lets users / scripts / editor
// integrations target arbitrary repos without `cd`-ing first.
y.option('repo', {
  type: 'string',
  alias: 'cwd',
  description: 'Target a specific repository directory instead of the current working directory.',
  global: true,
})

// Global `--verbose` (alias `-v`) — every subcommand inherits it.
// Flips `argv.verbose: true` so `commandExecutor` and `Logger` print
// stack traces / debug spans. Previously only settable via the
// `COCO_VERBOSE=true` env var or `coco.verbose` git/json config —
// `BaseArgvOptions.verbose` was typed but never declared as a yargs
// option, so passing `--verbose` from the CLI was a silent no-op.
y.option('verbose', {
  type: 'boolean',
  alias: 'v',
  description: 'Print verbose diagnostic output (stack traces on errors, debug spans).',
  global: true,
})

// Global `--quiet` (alias `-q`) — silences coco's chrome (banners, status
// lines, spinners) by flipping the Logger into silent mode. Results still
// reach stdout: `handleResult`'s stdout path and `emitJson` write to
// `process.stdout` directly, independent of the logger.
y.option('quiet', {
  type: 'boolean',
  alias: 'q',
  description: 'Suppress non-error status output. Results (and --json) still print to stdout.',
  default: false,
  global: true,
})

// Global `--json` — declared globally so it's a recognized, documented flag
// on every command. Commands that produce structured output (issues, prs,
// log, changelog, recap, review) read `argv.json` and emit via `emitJson`.
y.option('json', {
  type: 'boolean',
  description: 'Emit machine-readable JSON to stdout (supported commands only).',
  default: false,
  global: true,
})

// `$0` (no positional args) routes through the smart default router
// rather than aliasing directly to `coco commit`. The router probes
// the user's environment (config presence, git-repo presence) and
// forwards to `init` / `ui` / `workspace` / `commit` based on which
// of those is most likely to be helpful. Mirrors what other modern
// git-aware CLIs do (lazygit / tig / gitui) — fresh installs land in
// a setup wizard, configured users land in the TUI, scripts that
// rely on `coco commit` keep their dedicated subcommand entry.
y.command<DefaultRouteArgv>(
  '$0',
  'Smart entry point — routes to init / ui / workspace / commit based on your environment.',
  (yargs) => yargs.option('commit', {
    type: 'boolean',
    description: 'Force the legacy default — run `coco commit` regardless of routing.',
    default: false,
  }),
  // `commandExecutor` wraps every command with config loading, error
  // formatting, and exit-code handling. The router is a regular
  // command so it lights up the same plumbing for free.
  commandExecutor(defaultRouteHandler)
)

y.command<CommitOptions>(
  commit.command,
  commit.desc,
  commit.builder,
  commit.handler
)

y.command<AmendOptions>(
  amend.command,
  amend.desc,
  amend.builder,
  amend.handler
)

y.command<ChangelogOptions>(
  changelog.command,
  changelog.desc,
  changelog.builder,
  changelog.handler
)

y.command<RecapOptions>(
  recap.command,
  recap.desc,
  recap.builder,
  recap.handler
)

y.command<ReviewOptions>(
  review.command,
  review.desc,
  review.builder,
  review.handler
)

y.command<InitOptions>(
  init.command,
  init.desc,
  init.builder,
  init.handler
)

y.command<DoctorOptions>(
  doctor.command,
  doctor.desc,
  doctor.builder,
  doctor.handler
)

y.command<LogOptions>(
  log.command,
  log.desc,
  log.builder,
  log.handler
)

y.command<UiOptions>(
  ui.command,
  ui.desc,
  ui.builder,
  ui.handler
)

y.command<WorkspaceOptions>(
  workspace.command,
  workspace.desc,
  workspace.builder,
  workspace.handler
)

y.command<CacheOptions>(
  cache.command,
  cache.desc,
  cache.builder,
  cache.handler
)

y.command<ConfigCmdOptions>(
  configCmd.command,
  configCmd.desc,
  configCmd.builder,
  configCmd.handler
)

y.command<IssuesOptions>(
  issues.command,
  issues.desc,
  issues.builder,
  issues.handler
)

y.command<PrCreateOptions>(
  prCreate.command,
  prCreate.desc,
  prCreate.builder,
  prCreate.handler
)

y.command<PrsOptions>(
  prs.command,
  prs.desc,
  prs.builder,
  prs.handler
)

// `COCO_PREFETCH` hook (#933 phase 3). When set, downloads any
// requested lazy-load tree-sitter parsers into the user's cache
// dir before yargs hands control to a subcommand. No-op when
// unset, so the typical CLI path pays zero overhead.
//
// Errors here are non-fatal: a failed download prints a warning
// to stderr; the subcommand still runs (just with the regex
// fallback for that language).
import { runPrefetchFromEnv } from './lib/parsers/default/__tree_sitter__/prefetch'

async function main(): Promise<void> {
  await runPrefetchFromEnv()
  // .strictOptions() rejects unknown option names (e.g. `--interactve` typos)
  // with a clear "Unknown argument" error and non-zero exit. We use
  // .strictOptions() rather than .strict() so that positional arguments
  // (e.g. `cache <subcommand>`) are still accepted.
  // --no-<flag> negations of declared booleans are automatically allowed by
  // yargs and are not affected by this setting.
  y.strictOptions().help().parse(process.argv.slice(2))
}

main().catch((error) => {
  process.exit(handleFatalError(error))
})

export {
  cache,
  changelog,
  commit,
  Config,
  configCmd,
  doctor,
  init,
  issues,
  log,
  prs,
  recap,
  types,
  ui,
  workspace,
}
