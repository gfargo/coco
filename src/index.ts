#!/usr/bin/env node
import yargs from 'yargs'
import * as commit from './commands/commit'

yargs
  .scriptName('coco')
  .commandDir('./commands', {
    extensions: ['ts'],
  })
  .demandCommand()
  .strict()
  .option('h', { alias: 'help' })
  .option('v', {
    alias: 'verbose',
    type: 'boolean',
    description: 'Run with verbose logging',
  }).argv

export { commit }
