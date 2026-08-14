import chalk from 'chalk'
import {
  ConflictExplanation,
  runConflictExplanationWorkflow,
} from '../../git/conflictAiActions'
import { ConflictRegion, getConflictFileRegions } from '../../git/conflictRegionActions'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel } from '../../lib/langchain/utils'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { commandExit } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { ResolveArgv, ResolveOptions } from './config'

type JsonExplanation = {
  path: string
  regionIndex: number
  startLine: number
  endLine: number
  oursIntent: string
  theirsIntent: string
  conflictNature: string
}

type FileExplanations = {
  path: string
  explanations: ConflictExplanation[]
  regionByIndex: Map<number, ConflictRegion>
  error?: string
}

/**
 * `coco resolve explain` — describes each conflict region's ours/theirs
 * intent and why they conflict, without proposing or applying any
 * resolution. Read-only counterpart to the default `coco resolve` flow.
 */
export const explainHandler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  const operation = await getInProgressOperationType(git)
  const conflicted = await getConflictedFiles(git)
  const targets = argv.file ? conflicted.filter((file) => file.path === argv.file) : conflicted

  if (argv.file && targets.length === 0) {
    return fail(logger, argv.json, `"${argv.file}" is not a conflicted file.`)
  }

  if (targets.length === 0) {
    if (argv.json) {
      emitJson([])
    } else {
      logger.log('No conflicts to explain')
    }
    return
  }

  // Only gate on credentials once we know there's actual AI work to do.
  const config = loadConfig<ResolveOptions, ResolveArgv>(argv)
  const key = getApiKeyForModel(config)
  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'resolve' })
  }

  const results: FileExplanations[] = []

  for (const file of targets) {
    const regionsResult = await getConflictFileRegions(git, file.path)
    if (!regionsResult.ok) {
      results.push({
        path: file.path,
        explanations: [],
        regionByIndex: new Map(),
        error: regionsResult.message,
      })
      continue
    }

    const regionByIndex = new Map(regionsResult.regions.map((region) => [region.index, region]))
    const workflowResult = await runConflictExplanationWorkflow({
      git,
      path: file.path,
      regions: regionsResult.regions,
      operation,
    })

    if (!workflowResult.ok) {
      results.push({ path: file.path, explanations: [], regionByIndex, error: workflowResult.message })
      continue
    }

    results.push({ path: file.path, explanations: workflowResult.explanations, regionByIndex })
  }

  if (argv.json) {
    const json: JsonExplanation[] = results.flatMap((result) =>
      result.explanations.map((explanation) => {
        const region = result.regionByIndex.get(explanation.regionIndex)
        return {
          path: result.path,
          regionIndex: explanation.regionIndex,
          startLine: region?.startLine ?? 0,
          endLine: region?.endLine ?? 0,
          oursIntent: explanation.oursIntent,
          theirsIntent: explanation.theirsIntent,
          conflictNature: explanation.conflictNature,
        }
      })
    )
    emitJson(json)
  } else {
    printExplanations(logger, results)
  }

  if (results.some((result) => Boolean(result.error))) {
    commandExit(1, 'resolve explain: failed for one or more files')
  }
}

function fail(logger: Logger, json: boolean | undefined, message: string): never {
  if (json) {
    emitJson({ error: message })
    commandExit(1)
  }
  logger.error(message, { color: 'red' })
  commandExit(1)
}

function printExplanations(logger: Logger, results: FileExplanations[]): void {
  for (const result of results) {
    if (result.error) {
      logger.log(`\n${chalk.bold(result.path)}`)
      logger.log(`  ${chalk.red('✗')} ${result.error}`)
      continue
    }

    logger.log(`\n${chalk.bold(result.path)}`)
    for (const explanation of [...result.explanations].sort((a, b) => a.regionIndex - b.regionIndex)) {
      const region = result.regionByIndex.get(explanation.regionIndex)
      const lines = region ? `lines ${region.startLine}-${region.endLine}` : ''
      logger.log(`  ${chalk.cyan(`Region ${explanation.regionIndex}`)} (${lines})`)
      logger.log(`    ${chalk.bold('Ours:')} ${explanation.oursIntent}`)
      logger.log(`    ${chalk.bold('Theirs:')} ${explanation.theirsIntent}`)
      logger.log(`    ${chalk.bold('Conflict:')} ${explanation.conflictNature}`)
    }
  }
}
