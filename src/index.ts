#!/usr/bin/env node
import yargs from 'yargs'
import cache from './commands/cache'
import changelog from './commands/changelog'
import commit from './commands/commit'
import doctor from './commands/doctor'
import init from './commands/init'
import issues from './commands/issues'
import log from './commands/log'
import prs from './commands/prs'
import recap from './commands/recap'
import review from './commands/review'
import ui from './commands/ui'
import workspace from './commands/workspace'

import { CacheOptions } from './commands/cache/config'
import { ChangelogOptions } from './commands/changelog/config'
import { CommitOptions } from './commands/commit/config'
import { DoctorOptions } from './commands/doctor/config'
import { InitOptions } from './commands/init/config'
import { IssuesOptions } from './commands/issues/config'
import { LogOptions } from './commands/log/config'
import { PrsOptions } from './commands/prs/config'
import { RecapOptions } from './commands/recap/config'
import { ReviewOptions } from './commands/review/config'
import { UiOptions } from './commands/ui/config'
import { WorkspaceOptions } from './commands/workspace/config'
import { Config } from './lib/config/types'
import * as types from './lib/types'

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

y.command<CommitOptions>(
  [commit.command, '$0'],
  commit.desc,
  commit.builder,
  commit.handler
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
  y.help().parse(process.argv.slice(2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
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
