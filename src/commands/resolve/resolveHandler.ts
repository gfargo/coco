import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import chalk from 'chalk'
import { SimpleGit } from 'simple-git'
import {
  ConflictResolutionProposal,
  runConflictResolutionWorkflow,
} from '../../git/conflictAiActions'
import {
  applyConflictResolution,
  ConflictRegion,
  getConflictFileRegions,
} from '../../git/conflictRegionActions'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { stageConflictResolved } from '../../git/operationActions'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel } from '../../lib/langchain/utils'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { selectPrompt } from '../../lib/ui/inquirerPrompts'
import { commandExit } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { ConfidenceLevel, ResolveArgv, ResolveOptions } from './config'

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 }

type InteractiveAction = 'accept' | 'edit' | 'skip' | 'quit'

type FileTally = {
  path: string
  regions: number
  resolved: number
  skipped: number
  failed: number
  staged: boolean
  proposals?: ConflictResolutionProposal[]
  error?: string
}

/**
 * `coco resolve` — turns AI-proposed conflict resolutions into applied,
 * staged changes. Three modes, chosen by flags:
 *   - interactive (default): accept / edit / skip / quit per region.
 *   - `--dry-run`: prints proposals, never writes or applies anything.
 *   - `--apply --confidence <level>`: auto-applies proposals at/above the
 *     threshold, skipping the rest with a stated reason.
 */
export const resolveHandler: CommandHandler<ResolveArgv> = async (argv, logger) => {
  if (argv.dryRun && argv.apply) {
    return fail(logger, argv.json, '--dry-run and --apply cannot be used together.')
  }

  const git = applyRepoFlag(argv)
  const mode: 'interactive' | 'dry-run' | 'apply' = argv.dryRun
    ? 'dry-run'
    : argv.apply
      ? 'apply'
      : 'interactive'
  const confidenceThreshold: ConfidenceLevel = argv.confidence || 'medium'

  const operation = await getInProgressOperationType(git)
  const conflicted = await getConflictedFiles(git)
  const targets = argv.file ? conflicted.filter((file) => file.path === argv.file) : conflicted

  if (targets.length === 0) {
    return fail(
      logger,
      argv.json,
      argv.file ? `"${argv.file}" is not a conflicted file.` : 'No conflicted files found.'
    )
  }

  // Only gate on credentials once we know there's actual AI work to do —
  // `coco resolve` in a clean repo (or targeting a file that isn't
  // conflicted) should never require an API key.
  const config = loadConfig<ResolveOptions, ResolveArgv>(argv)
  const key = getApiKeyForModel(config)
  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'resolve' })
  }

  const tallies: FileTally[] = []

  for (const file of targets) {
    const tally: FileTally = {
      path: file.path,
      regions: 0,
      resolved: 0,
      skipped: 0,
      failed: 0,
      staged: false,
    }
    tallies.push(tally)

    const regionsResult = await getConflictFileRegions(git, file.path)
    if (!regionsResult.ok) {
      tally.error = regionsResult.message
      continue
    }
    tally.regions = regionsResult.regions.length

    const workflowResult = await runConflictResolutionWorkflow({
      git,
      path: file.path,
      regions: regionsResult.regions,
      operation,
      tokenBudget: config.service.tokenLimit || 4096,
    })

    if (!workflowResult.ok) {
      tally.error = workflowResult.message
      continue
    }

    if (mode === 'dry-run') {
      tally.proposals = workflowResult.proposals
      if (!argv.json) printDryRunProposals(logger, file.path, workflowResult.proposals)
      continue
    }

    const regionByIndex = new Map(regionsResult.regions.map((region) => [region.index, region]))

    if (mode === 'apply') {
      await runApplyMode({
        git,
        path: file.path,
        proposals: workflowResult.proposals,
        regionByIndex,
        confidenceThreshold,
        tally,
        logger,
      })
    } else {
      const quit = await runInteractiveMode({
        git,
        path: file.path,
        proposals: workflowResult.proposals,
        regionByIndex,
        tally,
        logger,
      })
      if (quit) break
    }
  }

  const unresolved = tallies.some((tally) => Boolean(tally.error) || tally.regions - tally.resolved > 0)

  if (argv.json) {
    emitJson({
      mode,
      operation,
      confidence: mode === 'apply' ? confidenceThreshold : undefined,
      files: tallies.map((tally) => ({
        path: tally.path,
        regions: tally.regions,
        resolved: tally.resolved,
        skipped: tally.skipped,
        failed: tally.failed,
        staged: tally.staged,
        ...(tally.proposals
          ? {
              proposals: tally.proposals.map((proposal) => ({
                regionIndex: proposal.regionIndex,
                confidence: proposal.confidence,
                rationale: proposal.rationale,
                resolution: proposal.resolution,
              })),
            }
          : {}),
        ...(tally.error ? { error: tally.error } : {}),
      })),
    })
  } else {
    printSummary(logger, mode, tallies)
  }

  if (mode !== 'dry-run' && unresolved) {
    commandExit(1, 'resolve: conflicts remain unresolved')
  }
  if (mode === 'dry-run' && tallies.some((tally) => Boolean(tally.error))) {
    commandExit(1, 'resolve: dry-run failed for one or more files')
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

function printDryRunProposals(
  logger: Logger,
  path: string,
  proposals: ConflictResolutionProposal[]
): void {
  logger.log(`\n${chalk.bold(path)} — ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}`)
  for (const proposal of [...proposals].sort((a, b) => a.regionIndex - b.regionIndex)) {
    logger.log(`  ${chalk.cyan(`Region ${proposal.regionIndex}`)} [${proposal.confidence}] ${proposal.rationale}`)
  }
}

function printSummary(logger: Logger, mode: string, tallies: FileTally[]): void {
  logger.log(`\n${chalk.bold('coco resolve')} (${mode}) summary:`)
  for (const tally of tallies) {
    if (tally.error) {
      logger.log(`  ${chalk.red('✗')} ${tally.path} — ${tally.error}`)
      continue
    }
    const staged = tally.staged ? ', staged' : ''
    logger.log(
      `  ${chalk.bold(tally.path)} — ${tally.resolved} resolved, ${tally.skipped} skipped, ${tally.failed} failed${staged}`
    )
  }
}

/** Applies proposals at/above `confidenceThreshold`; skips the rest with a stated reason. */
async function runApplyMode(input: {
  git: SimpleGit
  path: string
  proposals: ConflictResolutionProposal[]
  regionByIndex: Map<number, ConflictRegion>
  confidenceThreshold: ConfidenceLevel
  tally: FileTally
  logger: Logger
}): Promise<void> {
  const { git, path, proposals, regionByIndex, confidenceThreshold, tally, logger } = input

  // Bottom-up (descending region index) so a mid-run failure leaves the
  // file's earlier regions still readable, mirroring the workstation TUI's
  // "accept all" ordering.
  const ordered = [...proposals].sort((a, b) => b.regionIndex - a.regionIndex)

  for (const proposal of ordered) {
    if (CONFIDENCE_RANK[proposal.confidence] < CONFIDENCE_RANK[confidenceThreshold]) {
      tally.skipped += 1
      logger.log(
        `  ${chalk.yellow('skip')} ${path} region ${proposal.regionIndex} — confidence ${proposal.confidence} below ${confidenceThreshold}`
      )
      continue
    }
    const region = regionByIndex.get(proposal.regionIndex)
    if (!region) {
      tally.failed += 1
      continue
    }
    await applyAndTally(git, path, region, proposal.resolution, tally, logger)
  }
}

/** Interactive accept/edit/skip/quit loop for one file's proposals. Returns true when the user quit. */
async function runInteractiveMode(input: {
  git: SimpleGit
  path: string
  proposals: ConflictResolutionProposal[]
  regionByIndex: Map<number, ConflictRegion>
  tally: FileTally
  logger: Logger
}): Promise<boolean> {
  const { git, path, proposals, regionByIndex, tally, logger } = input
  const ordered = [...proposals].sort((a, b) => a.regionIndex - b.regionIndex)

  for (const proposal of ordered) {
    const region = regionByIndex.get(proposal.regionIndex)
    if (!region) continue

    logger.log(
      `\n${chalk.cyan(`Region ${proposal.regionIndex}`)} in ${chalk.bold(path)} [${proposal.confidence}]`
    )
    logger.log(`${proposal.rationale}\n`)
    logger.log(proposal.resolution)

    const action = await selectPrompt<InteractiveAction>({
      message: `Region ${proposal.regionIndex}:`,
      choices: [
        { name: 'Accept', value: 'accept' },
        { name: 'Edit', value: 'edit' },
        { name: 'Skip', value: 'skip' },
        { name: 'Quit', value: 'quit' },
      ],
    })

    if (action === 'quit') {
      return true
    }
    if (action === 'skip') {
      tally.skipped += 1
      continue
    }

    let resolution = proposal.resolution
    if (action === 'edit') {
      const edited = editProposalInEditor(resolution, path, logger)
      if (edited === undefined) {
        tally.skipped += 1
        continue
      }
      resolution = edited
    }

    await applyAndTally(git, path, region, resolution, tally, logger)
  }

  return false
}

/** Applies one region's resolution and stages the file once it's marker-free. */
async function applyAndTally(
  git: SimpleGit,
  path: string,
  region: ConflictRegion,
  resolution: string,
  tally: FileTally,
  logger: Logger
): Promise<void> {
  const result = await applyConflictResolution(git, path, region, resolution)
  if (!result.ok) {
    logger.error(`  ${result.message}`, { color: 'red' })
    tally.failed += 1
    return
  }
  tally.resolved += 1

  if (result.remainingRegions === 0) {
    const staged = await stageConflictResolved(git, path)
    tally.staged = staged.ok
    logger.log(
      staged.ok
        ? `  ${chalk.green('✓')} ${path} fully resolved and staged`
        : `  ${chalk.yellow('!')} ${path} resolved, but staging failed: ${staged.message}`
    )
  }
}

/**
 * Writes `resolution` to a temp file, opens it in $VISUAL/$EDITOR/vi, and
 * reads the result back. Mirrors the workstation TUI's edit flow
 * (useConflictResolutionActions.ts) minus the alt-screen escape sequences
 * — a plain CLI has no alt screen to restore. Returns undefined when the
 * editor couldn't be launched or exited without saving.
 */
function editProposalInEditor(resolution: string, path: string, logger: Logger): string | undefined {
  let dir: string
  try {
    dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-conflict-edit-'))
  } catch (error) {
    logger.error(`  Failed to create temp file: ${(error as Error).message}`, { color: 'red' })
    return undefined
  }

  const ext = nodePath.extname(path) || '.txt'
  const file = nodePath.join(dir, `resolution${ext}`)
  try {
    writeFileSync(file, resolution, 'utf8')

    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'

    const result = spawnSync(editor, [...editorArgs.slice(1), file], { stdio: 'inherit' })
    if (result.error) {
      logger.error(`  Failed to launch ${editor}: ${result.error.message}`, { color: 'red' })
      return undefined
    }
    if (result.signal || (typeof result.status === 'number' && result.status !== 0)) {
      logger.error(`  ${editor} exited without saving — proposal unchanged.`, { color: 'yellow' })
      return undefined
    }

    return readFileSync(file, 'utf8')
  } catch (error) {
    logger.error(`  Edit failed: ${(error as Error).message}`, { color: 'red' })
    return undefined
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
