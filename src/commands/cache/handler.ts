import * as fs from 'node:fs'

import chalk from 'chalk'

import {
  clearDiffSummaryCache,
  getDiffSummaryCachePath,
} from '../../lib/parsers/default/utils/diffSummaryCache'
import { CommandHandler } from '../../lib/types'
import { CacheArgv } from './config'

type CacheEntry = {
  summary: string
  model: string
  tokens: number
  lastAccessedAt: string
}

type CacheEnvelope = {
  version: number
  savedAt: string
  entries: Record<string, CacheEntry>
}

function readEnvelopeOrUndefined(filePath: string): CacheEnvelope | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as CacheEnvelope
  } catch {
    return undefined
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export const handler: CommandHandler<CacheArgv> = async (argv, logger) => {
  const subcommand = (argv as { subcommand?: string }).subcommand
  const repoPath = process.cwd()
  const cachePath = getDiffSummaryCachePath(repoPath)

  if (subcommand === 'clear') {
    const result = clearDiffSummaryCache(repoPath)
    if (!result.ok) {
      logger.log(chalk.red(`Failed to clear diff-summary cache at ${cachePath}`))
      process.exitCode = 1
      return
    }
    if (result.removed) {
      logger.log(chalk.green(`Cleared diff-summary cache at ${cachePath}`))
    } else {
      logger.log(chalk.dim(`No diff-summary cache to clear (${cachePath})`))
    }
    return
  }

  if (subcommand === 'info') {
    const envelope = readEnvelopeOrUndefined(cachePath)
    if (!envelope) {
      logger.log(chalk.dim(`No diff-summary cache for this repo (${cachePath})`))
      return
    }
    const stat = fs.statSync(cachePath)
    const entryCount = Object.keys(envelope.entries).length
    const totalSummaryTokens = Object.values(envelope.entries).reduce(
      (sum, entry) => sum + entry.tokens,
      0
    )
    logger.log(chalk.bold('Diff-summary cache') + ` ${chalk.dim(cachePath)}`)
    logger.log(`  ${chalk.green('entries')}            ${entryCount}`)
    logger.log(`  ${chalk.green('on-disk size')}       ${formatBytes(stat.size)}`)
    logger.log(`  ${chalk.green('summary tokens')}     ${totalSummaryTokens}`)
    logger.log(`  ${chalk.green('last saved')}         ${envelope.savedAt}`)
    return
  }

  logger.log(chalk.red(`Unknown cache subcommand: ${subcommand}`))
  logger.log(chalk.dim('Use one of: clear, info'))
  process.exitCode = 1
}
