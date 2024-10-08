#!/usr/bin/env node
import yargs from 'yargs'
import changelog from './commands/changelog'
import commit from './commands/commit'
import init from './commands/init'

import { ChangelogOptions } from './commands/changelog/options'
import { CommitOptions } from './commands/commit/options'
import { InitOptions } from './commands/init/options'
import { Config } from './lib/config/types'
import * as types from './lib/types'
import { USAGE_BANNER } from './lib/ui/helpers'

const y = yargs()

y.scriptName('coco')
.usage(USAGE_BANNER)

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

y.command<InitOptions>(
  init.command,
  init.desc,
  init.builder,
  init.handler
)

y.help().parse(process.argv.slice(2))

export { changelog, commit, Config, init, types }
