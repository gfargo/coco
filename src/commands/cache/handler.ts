import * as fs from 'node:fs'

import chalk from 'chalk'

import {
  clearCachedParser,
  getCachedParserStatus,
  type LazyTreeSitterLanguageId,
} from '../../lib/parsers/default/__tree_sitter__/cache'
import {
  listManifestLanguages,
  TREE_SITTER_MANIFEST,
} from '../../lib/parsers/default/__tree_sitter__/manifest'
import {
  parsePrefetchEnv,
  prefetchTreeSitterParsers,
} from '../../lib/parsers/default/__tree_sitter__/prefetch'
import {
  clearDiffSummaryCache,
  getDiffSummaryCachePath,
} from '../../lib/parsers/default/utils/diffSummaryCache'
import { clearGitHubListCache } from '../../git/githubListCache'
import { checkboxPrompt } from '../../lib/ui/inquirerPrompts'
import { CommandHandler } from '../../lib/types'
import { applyRepoCwd } from '../utils/applyRepoFlag'
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

/**
 * Render the tree-sitter parser cache table (`coco cache parsers`).
 * One row per manifest entry — cached size + version + URL — plus
 * a footer summarizing total disk usage. Mirrors the diff-summary
 * `info` output style.
 */
function renderParsersTable(
  logger: { log: (s: string) => void },
): void {
  const languages = listManifestLanguages()
  let totalBytes = 0
  let cachedCount = 0

  logger.log(chalk.bold('Tree-sitter parser cache'))
  logger.log('')
  for (const language of languages) {
    const entry = TREE_SITTER_MANIFEST[language]
    const status = getCachedParserStatus(language)
    const stateLabel = status.cached
      ? chalk.green('cached')
      : chalk.dim('not cached')
    const size = status.cached && status.bytes !== undefined
      ? chalk.dim(`(${formatBytes(status.bytes)})`)
      : chalk.dim(`(${formatBytes(entry.approxBytes)} when fetched)`)
    if (status.cached && status.bytes !== undefined) {
      totalBytes += status.bytes
      cachedCount += 1
    }
    logger.log(
      `  ${chalk.bold(entry.displayName.padEnd(8))} ${stateLabel.padEnd(20)}${size}`,
    )
    logger.log(`           ${chalk.dim(`v${entry.version} · ${entry.wasmUrl}`)}`)
  }

  logger.log('')
  logger.log(
    `  ${chalk.dim('cached:')} ${cachedCount}/${languages.length}  ` +
    `${chalk.dim('total on disk:')} ${formatBytes(totalBytes)}`,
  )
  logger.log('')
  logger.log(chalk.dim('  Prefetch a language:    coco cache prefetch py'))
  logger.log(chalk.dim('  Pick interactively:     coco cache prefetch'))
  logger.log(chalk.dim('  Clear the parser cache: coco cache clear-parsers'))
}

/**
 * Resolve a list of user-supplied tokens (and aliases) into canonical
 * language ids. Reuses the prefetch module's env-var parser so the
 * grammar stays in lockstep — `py` / `python` / `rs` / `rust` / `go` /
 * `golang` / `all` all map the same way they do for `COCO_PREFETCH`.
 *
 * Empty input returns an empty result with `interactive: true` to
 * signal the caller should show the checkbox picker.
 */
function resolveLanguageTokens(tokens: string[]): {
  resolved: LazyTreeSitterLanguageId[]
  unknown: string[]
  interactive: boolean
} {
  if (tokens.length === 0) {
    return { resolved: [], unknown: [], interactive: true }
  }
  const parsed = parsePrefetchEnv(tokens.join(','))
  return { ...parsed, interactive: false }
}

/**
 * Interactive checkbox prompt: pick which languages to download.
 * Each row shows the language, its current cache status, and the
 * approximate / actual on-disk size.
 *
 * Gated by `process.stdin.isTTY` — non-interactive contexts (CI,
 * pipes) get an error message instead of hanging on the prompt.
 */
async function promptLanguageSelection(
  logger: { log: (s: string) => void },
): Promise<LazyTreeSitterLanguageId[] | undefined> {
  if (!process.stdin.isTTY) {
    logger.log(chalk.red('`coco cache prefetch` with no args requires an interactive TTY.'))
    logger.log(chalk.dim('In a pipe / CI, pass the languages explicitly:'))
    logger.log(chalk.dim('  coco cache prefetch py rs go'))
    logger.log(chalk.dim('  coco cache prefetch all'))
    return undefined
  }
  const choices = listManifestLanguages().map((language) => {
    const entry = TREE_SITTER_MANIFEST[language]
    const status = getCachedParserStatus(language)
    return {
      name: status.cached
        ? `${entry.displayName} (cached, ${formatBytes(status.bytes ?? entry.approxBytes)})`
        : `${entry.displayName} (~${formatBytes(entry.approxBytes)})`,
      value: language,
      checked: false,
    }
  })
  const picked = await checkboxPrompt<LazyTreeSitterLanguageId>({
    message: 'Which tree-sitter parsers to (re)download?',
    choices,
    instructions: ' (Space toggles · Enter confirms)',
  })
  return picked
}

export const handler: CommandHandler<CacheArgv> = async (argv, logger) => {
  const subcommand = (argv as { subcommand?: string }).subcommand
  const positionalLanguages = ((argv as { languages?: string[] }).languages || [])
    .map((s) => s.trim())
    .filter(Boolean)
  // Honor the global --repo flag so `coco cache info --repo <X>`
  // inspects X's cache, not the launcher's cwd. applyRepoCwd
  // performs the chdir when needed and returns the canonical path.
  const repoPath = applyRepoCwd(argv)
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

  if (subcommand === 'parsers') {
    renderParsersTable(logger)
    return
  }

  if (subcommand === 'prefetch') {
    const { resolved: resolvedFromArgs, unknown, interactive } =
      resolveLanguageTokens(positionalLanguages)
    if (unknown.length > 0) {
      logger.log(chalk.yellow(
        `! ignoring unknown language(s): ${unknown.join(', ')}. ` +
        `Known: ${listManifestLanguages().join(', ')}`,
      ))
    }
    let resolved = resolvedFromArgs
    if (interactive) {
      const picked = await promptLanguageSelection(logger)
      if (!picked) {
        process.exitCode = 1
        return
      }
      resolved = picked
    }
    if (resolved.length === 0) {
      logger.log(chalk.dim('No languages selected. Nothing to do.'))
      return
    }
    const result = await prefetchTreeSitterParsers(resolved, {
      writeLine: (line: string) => logger.log(line),
    })
    logger.log('')
    logger.log(
      `${chalk.bold('Summary:')} ` +
      `${chalk.green(`${result.downloaded.length} downloaded`)} · ` +
      `${chalk.dim(`${result.alreadyCached.length} already cached`)} · ` +
      `${chalk.red(`${result.failed.length} failed`)}`,
    )
    if (result.failed.length > 0) {
      process.exitCode = 1
    }
    return
  }

  if (subcommand === 'clear-github') {
    const result = clearGitHubListCache()
    if (result.removed === 0) {
      logger.log(chalk.dim('No GitHub triage cache to clear.'))
      return
    }
    logger.log(chalk.green(`✓ cleared ${result.removed} cached GitHub triage list${result.removed === 1 ? '' : 's'}`))
    logger.log(chalk.dim('Cleared from ~/.cache/coco/github/'))
    return
  }

  if (subcommand === 'clear-parsers') {
    const languages = listManifestLanguages()
    let cleared = 0
    for (const language of languages) {
      if (clearCachedParser(language)) {
        cleared += 1
        logger.log(chalk.green(`✓ cleared ${TREE_SITTER_MANIFEST[language].displayName}`))
      }
    }
    if (cleared === 0) {
      logger.log(chalk.dim('No tree-sitter parsers cached. Nothing to clear.'))
      return
    }
    logger.log('')
    logger.log(chalk.dim(`Cleared ${cleared} parser(s) from ~/.cache/coco/tree-sitter/`))
    return
  }

  logger.log(chalk.red(`Unknown cache subcommand: ${subcommand}`))
  logger.log(chalk.dim('Use one of: clear, info, parsers, prefetch, clear-parsers, clear-github'))
  process.exitCode = 1
}
