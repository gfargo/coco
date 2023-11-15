#!/usr/bin/env node
import yargs from 'yargs'
import commit from './commands/commit'
import changelog from './commands/changelog'

yargs
  .scriptName('coco')
  .usage('$0 <cmd> [args]')
  .command(
    [commit.command, '$0'],
    commit.desc,
    // TODO: fix type on builder
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    commit.builder,
    commit.handler
  )
  .command(
    changelog.command,
    changelog.desc,
    // TODO: fix type on builder
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    changelog.builder,
    changelog.handler
  )
  .demandCommand()
  .help().argv
