#!/usr/bin/env node
import yargs from 'yargs'
import commit from './commands/commit'
import changelog from './commands/changelog'
import init from './commands/init'

import * as types from './lib/types'
import { Config } from './lib/config/types'

const y = yargs()

y.scriptName('coco').usage('$0 <cmd> [args]')

y.command(
  [commit.command, '$0'],
  commit.desc,
  // TODO: fix type on builder
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  commit.builder,
  commit.handler
)

y.command(
  changelog.command,
  changelog.desc,
  // TODO: fix type on builder
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  changelog.builder,
  changelog.handler
)

y.command(
  init.command,
  init.desc,
  // TODO: fix type on builder
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  init.builder,
  init.handler
)

y.parse(process.argv.slice(2))

export { changelog, commit, init, types, Config }
