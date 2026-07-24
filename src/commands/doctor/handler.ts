import * as fs from 'fs'
import chalk from 'chalk'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getConfigSources, ConfigSourceInfo } from '../../lib/config/utils/loadConfig'
import { SCHEMA_PUBLIC_URL } from '../../lib/schema'
import { CommandHandler } from '../../lib/types'
import { FAIL, INFO, PASS, WARN } from '../../lib/ui/glyphs'
import { LOGO } from '../../lib/ui/helpers'
import { commandExit } from '../../lib/utils/commandExit'
import { applyRepoCwd } from '../utils/applyRepoFlag'
import { emitJson } from '../../lib/ui/emitJson'
import { buildModelRoutingProfile } from '../../lib/langchain/utils/modelRoutingProfile'
import {
    clearUsageLog,
    getUsageLogPath,
    isUsageLoggingEnabled,
    readUsageRecords,
    summarizeUsageByModel,
    summarizeUsageByRepo,
    summarizeUsageBySurface,
    summarizeUsageByTask,
    type UsageAggregate,
} from '../../lib/langchain/utils/usageLedger'
import { DoctorArgv, DoctorOptions } from './config'
import { checkOllamaLiveness, DiagnosticSeverity, runDiagnostics } from './checks'
import { Config } from '../../lib/config/types'

function renderUsageRows(rows: UsageAggregate[], unit: string): string[] {
  return rows.map((row) => {
    const tokens = row.promptTokens > 0 || row.completionTokens > 0
      ? `${row.promptTokens} in / ${row.completionTokens} out tok`
      : '–'
    return `  ${row.key.padEnd(14)} ${String(row.calls).padStart(4)} ${unit}  ${tokens.padStart(10)}  avg ${row.avgMs}ms`
  })
}

/**
 * `coco doctor --cost`: the model routing cost profile (which model runs each
 * dynamic-model task) plus, when the opt-in usage ledger has data, aggregated
 * tokens + latency by task and model.
 */
function renderCostReport(config: Config, logger: Parameters<CommandHandler<DoctorArgv>>[1], json: boolean): void {
  const profile = buildModelRoutingProfile(config)
  const records = readUsageRecords()
  const byTask = summarizeUsageByTask(records)
  const byModel = summarizeUsageByModel(records)
  const bySurface = summarizeUsageBySurface(records)
  const byRepo = summarizeUsageByRepo(records)
  const hasRepoData = byRepo.some((row) => row.key !== 'unknown')

  if (json) {
    emitJson({
      routing: profile,
      usage: { records: records.length, byTask, byModel, bySurface, byRepo },
    })
    return
  }

  logger.log(chalk.bold('Model routing') + chalk.dim(
    profile.dynamic ? ` (dynamic · preference: ${profile.preference})` : ' (fixed model)'
  ))
  logger.log('')
  for (const row of profile.rows) {
    logger.log(`  ${row.task.padEnd(14)} ${chalk.cyan(row.model)}`)
  }
  logger.log('')

  if (records.length === 0) {
    if (isUsageLoggingEnabled()) {
      logger.log(chalk.dim(`No usage recorded yet (logging to ${getUsageLogPath()}).`))
    } else {
      logger.log(
        chalk.dim(
          'Usage recording is off. Turn it on with `coco init`, telemetry.usage=true, or COCO_USAGE_LOG=1.'
        )
      )
    }
    return
  }

  logger.log(chalk.bold(`LLM usage`) + chalk.dim(` (${records.length} call(s) · ${getUsageLogPath()})`))
  logger.log('')
  logger.log(chalk.dim('  By task:'))
  for (const line of renderUsageRows(byTask, 'call')) logger.log(line)
  logger.log('')
  logger.log(chalk.dim('  By model:'))
  for (const line of renderUsageRows(byModel, 'call')) logger.log(line)
  logger.log('')
  logger.log(chalk.dim('  By surface:'))
  for (const line of renderUsageRows(bySurface, 'call')) logger.log(line)
  if (hasRepoData) {
    logger.log('')
    logger.log(chalk.dim('  By repo:'))
    for (const line of renderUsageRows(byRepo, 'call')) logger.log(line)
  }
}

const SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  error: FAIL(),
  warn: WARN(),
  info: INFO(),
}

const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  error: chalk.red('error'),
  warn: chalk.yellow('warn'),
  info: chalk.blue('info'),
}

const SOURCE_LABELS: Record<string, string> = {
  default: 'Built-in defaults',
  xdg: 'XDG config',
  git: 'Git config (~/.gitconfig)',
  project: 'Project config',
  env: 'Environment variables',
}

function formatSourceInfo(sources: ConfigSourceInfo[]): string[] {
  const lines: string[] = []
  for (const source of sources) {
    const label = SOURCE_LABELS[source.source] || source.source
    if (source.path) {
      lines.push(`  ${PASS()} ${label} ${chalk.dim(`(${source.path})`)}`)
    } else {
      lines.push(`  ${PASS()} ${label}`)
    }
  }
  return lines
}

export const handler: CommandHandler<DoctorArgv> = async (argv, logger) => {
  // Honor the global --repo flag so `coco doctor --repo <X>`
  // inspects X's config sources, not the launcher's cwd. The chdir
  // has to happen before loadConfig so `findUp` walks the targeted
  // repo's tree.
  applyRepoCwd(argv)

  const config = loadConfig<DoctorOptions, DoctorArgv>(argv)
  const sources = getConfigSources()

  if (argv.clear) {
    const ledgerPath = getUsageLogPath()
    clearUsageLog()
    if (argv.json) {
      emitJson({ cleared: true, path: ledgerPath })
    } else {
      logger.log(LOGO)
      logger.log('')
      logger.log(chalk.green(`Cleared the local usage-stats ledger (${ledgerPath}).`))
    }
    return
  }

  if (argv.cost) {
    if (!argv.json) {
      logger.log(LOGO)
      logger.log('')
      logger.log(chalk.bold('coco doctor') + ' — cost report\n')
    }
    renderCostReport(config, logger, Boolean(argv.json))
    return
  }

  logger.log(LOGO)
  logger.log('')
  logger.log(chalk.bold('coco doctor') + ' — checking your configuration\n')

  // Show active config sources
  logger.log(chalk.bold('Config sources') + chalk.dim(' (lowest → highest precedence):\n'))
  const sourceLines = formatSourceInfo(sources)
  for (const line of sourceLines) {
    logger.log(line)
  }

  // Show inactive sources
  const activeSources = new Set(sources.map((s) => s.source))
  const allSources = ['xdg', 'git', 'project', 'env'] as const
  const inactive = allSources.filter((s) => !activeSources.has(s))
  if (inactive.length > 0) {
    logger.log('')
    for (const source of inactive) {
      const label = SOURCE_LABELS[source] || source
      logger.log(`  ${chalk.dim('–')} ${chalk.dim(label)} ${chalk.dim('(not found)')}`)
    }
  }

  logger.log('')

  // Run diagnostics — sync config checks plus live Ollama probes (daemon
  // reachability + configured-model-pulled), which need a network round-trip.
  const diagnostics = runDiagnostics(config)
  diagnostics.push(...(await checkOllamaLiveness(config)))

  if (diagnostics.length === 0) {
    logger.log(chalk.green(`${PASS()} No issues found. Your configuration looks good!`))
    return
  }

  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warn')
  const infos = diagnostics.filter((d) => d.severity === 'info')

  logger.log(chalk.bold('Diagnostics:\n'))

  for (const diagnostic of diagnostics) {
    const icon = SEVERITY_ICON[diagnostic.severity]
    const label = SEVERITY_LABEL[diagnostic.severity]
    logger.log(`${icon} ${label}: ${diagnostic.message}`)
    if (diagnostic.fix) {
      logger.log(chalk.dim(`  → ${diagnostic.fix}`))
    }
    logger.log('')
  }

  // Summary
  const parts: string[] = []
  if (errors.length > 0) parts.push(chalk.red(`${errors.length} error(s)`))
  if (warnings.length > 0) parts.push(chalk.yellow(`${warnings.length} warning(s)`))
  if (infos.length > 0) parts.push(chalk.blue(`${infos.length} info(s)`))
  logger.log(`Found ${parts.join(', ')}.\n`)

  // Auto-fix
  if (argv.fix) {
    const fixable = diagnostics.filter((d) => d.autoFix)
    if (fixable.length === 0) {
      logger.log(chalk.dim('No auto-fixable issues found.'))
      return
    }

    // Find the project config file to write to
    const projectSource = sources.find((s) => s.source === 'project')
    const configPath = projectSource?.path

    if (!configPath) {
      logger.log(
        chalk.yellow(
          'No project config file found. Run `coco init --scope project` first, then re-run `coco doctor --fix`.'
        )
      )
      logger.log(
        chalk.dim(
          '  Auto-fix writes to the project config file (.coco.json or .coco.config.json).'
        )
      )

      // If config is coming from git or env, explain
      const gitSource = sources.find((s) => s.source === 'git')
      const envSource = sources.find((s) => s.source === 'env')
      if (gitSource) {
        logger.log(
          chalk.dim(`  Your config is loaded from ${gitSource.path} — edit that file manually, or create a project config.`)
        )
      }
      if (envSource) {
        logger.log(
          chalk.dim('  Some config comes from environment variables — update those in your shell profile.')
        )
      }
      return
    }

    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

      for (const diagnostic of fixable) {
        diagnostic.autoFix!(raw)
        logger.log(chalk.green(`  ${PASS()} Fixed: ${diagnostic.message}`))
      }

      // Ensure $schema is present
      if (!raw.$schema) {
        raw.$schema = SCHEMA_PUBLIC_URL
      }

      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n')
      logger.log(chalk.green(`\nWrote ${fixable.length} fix(es) to ${configPath}`))
    } catch (e) {
      logger.error(chalk.red(`Failed to apply fixes: ${(e as Error).message}`), {})
    }
  } else {
    const fixable = diagnostics.filter((d) => d.autoFix)
    if (fixable.length > 0) {
      logger.log(chalk.dim(`${fixable.length} issue(s) can be auto-fixed. Run \`coco doctor --fix\` to apply.`))
    }
  }

  // Exit non-zero when error-severity diagnostics were surfaced so CI
  // pipelines can gate on `coco doctor` without parsing its stdout.
  // Warnings + infos still exit clean — they're informational, not
  // blockers. Auto-fixed errors keep the non-zero exit so the CI run
  // surfaces "we patched something for you, please commit it" rather
  // than masquerading as a passing check.
  if (errors.length > 0) {
    commandExit(1, `${errors.length} doctor error(s)`)
  }
}
