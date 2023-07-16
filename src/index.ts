#!/usr/bin/env node
import yargs from 'yargs'
import * as commit from './commands/commit'
import { loadConfig } from './lib/config/loadConfig'

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

export { commit, loadConfig }
