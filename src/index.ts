#!/usr/bin/env node
import yargs from 'yargs'
import amend from './commands/amend'
import cache from './commands/cache'
import changelog from './commands/changelog'
import commit from './commands/commit'
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

// #1587 — shell completions. yargs generates bash/zsh scripts natively
// (auto-detected from $SHELL at generation time) and answers
// `--get-yargs-completions` for live tab-completion in both. Fish has
// no yargs template, so `coco completion fish` is special-cased below
// to print a static script covering subcommands + global flags —
// intercepted before `y.parse()` runs so it can't collide with yargs'
// own hidden `completion` command.
y.completion(
  'completion',
  'Generate a shell completion script. Auto-detects bash/zsh from $SHELL; run `coco completion fish` for Fish.'
)

const FISH_COMPLETION_SUBCOMMANDS: Array<{ name: string; desc: string }> = [
  { name: firstCommandToken(commit.command), desc: commit.desc },
  { name: firstCommandToken(amend.command), desc: amend.desc },
  { name: firstCommandToken(changelog.command), desc: changelog.desc },
  { name: firstCommandToken(recap.command), desc: recap.desc },
  { name: firstCommandToken(review.command), desc: review.desc },
  { name: firstCommandToken(init.command), desc: init.desc },
  { name: firstCommandToken(doctor.command), desc: doctor.desc },
  { name: firstCommandToken(log.command), desc: log.desc },
  { name: firstCommandToken(ui.command), desc: ui.desc },
  { name: firstCommandToken(workspace.command), desc: workspace.desc },
  { name: firstCommandToken(cache.command), desc: cache.desc },
  { name: firstCommandToken(issues.command), desc: issues.desc },
  { name: firstCommandToken(prCreate.command), desc: prCreate.desc },
  { name: firstCommandToken(prs.command), desc: prs.desc },
]

const FISH_COMPLETION_GLOBAL_FLAGS: Array<{ name: string; desc: string }> = [
  { name: 'repo', desc: 'Target a specific repository directory instead of the current working directory.' },
  { name: 'verbose', desc: 'Print verbose diagnostic output.' },
  { name: 'quiet', desc: 'Suppress non-error status output.' },
  { name: 'json', desc: 'Emit machine-readable JSON to stdout (supported commands only).' },
  { name: 'help', desc: 'Show help.' },
]

function firstCommandToken(command: string | readonly string[]): string {
  const first = Array.isArray(command) ? command[0] : (command as string)
  return first.split(' ')[0]
}

function fishCompletionArgTriggered(rawArgs: string[]): boolean {
  if (rawArgs[0] !== 'completion') return false
  const rest = rawArgs.slice(1)
  return rest.includes('fish') || rest.includes('--shell=fish') ||
    (rest.includes('--shell') && rest[rest.indexOf('--shell') + 1] === 'fish')
}

// Escapes backslashes BEFORE quotes — reversing the order would let a
// description ending in a backslash consume the closing quote's own escape
// (`foo\` -> `"foo\"` reads as unterminated to fish), breaking out of the
// quoted string.
function fishQuoteEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function generateFishCompletionScript(): string {
  const subcommandLines = FISH_COMPLETION_SUBCOMMANDS
    .map(({ name, desc }) =>
      `complete -c coco -n "__fish_use_subcommand" -a "${name}" -d "${fishQuoteEscape(desc)}"`
    )
    .join('\n')
  const flagLines = FISH_COMPLETION_GLOBAL_FLAGS
    .map(({ name, desc }) => `complete -c coco -l ${name} -d "${fishQuoteEscape(desc)}"`)
    .join('\n')

  return `###-begin-coco-completions-###
#
# coco fish completion script
#
# Installation: coco completion fish > ~/.config/fish/completions/coco.fish
#
# Static subcommand + global-flag completion (no live --get-yargs-completions
# support, unlike the bash/zsh scripts from \`coco completion\`).
${subcommandLines}
${flagLines}
###-end-coco-completions-###
`
}

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
  const rawArgs = process.argv.slice(2)

  // `coco completion fish` short-circuits before yargs ever parses —
  // yargs' own hidden `completion` command only knows the bash/zsh
  // templates, so this is handled as a distinct, static code path
  // rather than fighting yargs for control of its own command.
  if (fishCompletionArgTriggered(rawArgs)) {
    process.stdout.write(generateFishCompletionScript())
    return
  }

  await runPrefetchFromEnv()
  // .strictOptions() rejects unknown option names (e.g. `--interactve` typos)
  // with a clear "Unknown argument" error and non-zero exit. We use
  // .strictOptions() rather than .strict() so that positional arguments
  // (e.g. `cache <subcommand>`) are still accepted.
  // --no-<flag> negations of declared booleans are automatically allowed by
  // yargs and are not affected by this setting.
  y.strictOptions().help().parse(rawArgs)
}

main().catch((error) => {
  process.exit(handleFatalError(error))
})

export {
  cache,
  changelog,
  commit,
  Config,
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
