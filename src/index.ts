#!/usr/bin/env node
import yargs from 'yargs'
import changelog from './commands/changelog'
import commit from './commands/commit'
import init from './commands/init'
import recap from './commands/recap'
import review from './commands/review'

import { ChangelogOptions } from './commands/changelog/config'
import { CommitOptions } from './commands/commit/config'
import { InitOptions } from './commands/init/config'
import { RecapOptions } from './commands/recap/config'
import { ReviewOptions } from './commands/review/config'
import { Config } from './lib/config/types'
import * as types from './lib/types'

const y = yargs()

y.scriptName('coco')

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

y.help().parse(process.argv.slice(2))

export { changelog, commit, Config, init, recap, types }

