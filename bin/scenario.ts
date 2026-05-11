#!/usr/bin/env tsx
/**
 * CLI driver for the scenario library — spin up a fake repo in a
 * named state for manual testing.
 *
 * Usage:
 *   npm run scenario list                          # show all scenarios
 *   npm run scenario describe <name>               # describe one
 *   npm run scenario create <name>                 # create in /tmp
 *   npm run scenario create <name> --path <dir>    # create at <dir>
 *   npm run scenario create <name> --run-ui        # create AND launch `coco ui`
 *
 * By default, `create` PERSISTS the scenario (doesn't auto-clean) —
 * that's what manual testing wants. Use `--ephemeral` to clean up on
 * exit (handy for one-shot smoke tests). The cleanup hint is printed
 * at the end either way.
 *
 * EXTRACTION NOTE: this CLI uses `coco` only for the optional `--run-ui`
 * flag (it spawns `tsx <coco>/src/index.ts ui` with the scenario dir as
 * cwd). The core scenario logic is agnostic to which tool consumes it;
 * only the convenience launcher knows about coco. When extracted to a
 * standalone package, the `--run-ui` flag becomes `--run <command>`
 * taking an arbitrary shell command — `lazygit`, `gitui`, etc. would
 * all work.
 */

import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

import { allScenarios, findScenario, type Scenario } from '../src/lib/testUtils/scenarios'
import { createTempGitRepo } from '../src/lib/testUtils/tempGitRepo'

type ParsedArgs = {
  command?: 'list' | 'describe' | 'create' | 'help'
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  let command: ParsedArgs['command']

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx > 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[arg.slice(2)] = argv[i + 1]
        i += 1
      } else {
        flags[arg.slice(2)] = true
      }
    } else if (!command) {
      if (arg === 'list' || arg === 'describe' || arg === 'create' || arg === 'help') {
        command = arg
      } else {
        positional.push(arg)
      }
    } else {
      positional.push(arg)
    }
  }

  return { command, positional, flags }
}

function printHelp(): void {
  console.log([
    '',
    '  npm run scenario — manage testing scenarios for the workstation',
    '',
    '  Usage:',
    '    npm run scenario list',
    '    npm run scenario describe <name>',
    '    npm run scenario create <name> [options]',
    '',
    '  Create options:',
    '    --path <dir>     Materialize the scenario at <dir> instead of /tmp',
    '    --run-ui         Launch `coco ui` against the scenario after creation',
    '    --ephemeral      Remove the scenario directory when the CLI exits',
    '                     (default: persist, print the cleanup hint)',
    '',
    `  Available scenarios (${allScenarios.length}):`,
    ...allScenarios.map((s) => `    ${s.name.padEnd(28)} ${s.summary}`),
    '',
  ].join('\n'))
}

function commandList(): void {
  console.log('')
  console.log(`Available scenarios (${allScenarios.length}):`)
  console.log('')
  const byKind = new Map<string, Scenario[]>()
  for (const scenario of allScenarios) {
    const bucket = byKind.get(scenario.kind) || []
    bucket.push(scenario)
    byKind.set(scenario.kind, bucket)
  }
  for (const [kind, scenarios] of byKind) {
    console.log(`  ${kind}:`)
    for (const s of scenarios) {
      console.log(`    ${s.name.padEnd(28)} ${s.summary}`)
    }
    console.log('')
  }
}

function commandDescribe(name: string): number {
  const scenario = findScenario(name)
  if (!scenario) {
    console.error(`Unknown scenario "${name}". Try \`npm run scenario list\`.`)
    return 2
  }
  console.log('')
  console.log(`  ${scenario.name}`)
  console.log(`  ${'-'.repeat(scenario.name.length)}`)
  console.log('')
  console.log(`  Summary: ${scenario.summary}`)
  console.log(`  Kind:    ${scenario.kind}`)
  console.log('')
  console.log(scenario.description.split('\n').map((l) => `  ${l}`).join('\n'))
  if (scenario.contracts && scenario.contracts.length > 0) {
    console.log('')
    console.log('  Contracts:')
    for (const c of scenario.contracts) {
      console.log(`    - ${c}`)
    }
  }
  console.log('')
  return 0
}

async function commandCreate(
  name: string,
  options: { targetPath?: string; runUi?: boolean; ephemeral?: boolean }
): Promise<number> {
  const scenario = findScenario(name)
  if (!scenario) {
    console.error(`Unknown scenario "${name}". Try \`npm run scenario list\`.`)
    return 2
  }

  console.log(`Building scenario "${scenario.name}"…`)
  const repo = await createTempGitRepo()

  // If the user passed --path, the scenario was built in a tmp dir and
  // we move it. Doing the build-then-move dance means the scenarios
  // don't need to know about the user's target path — they always run
  // against the same standardized tempGitRepo shape.
  try {
    await scenario.setup(repo)
  } catch (error) {
    console.error(`Scenario setup failed: ${(error as Error).message}`)
    return 1
  }

  let finalPath = repo.path
  if (options.targetPath) {
    const target = path.resolve(options.targetPath)
    // Use git's own porcelain to clone the bare result somewhere else
    // would preserve history but lose worktree state. Plain rename
    // keeps everything intact and is what manual testers expect when
    // they say "put this scenario at ~/sandbox".
    const renameResult = spawnSync('mv', [repo.path, target])
    if (renameResult.status !== 0) {
      console.error(`Failed to move scenario to ${target}`)
      return 1
    }
    finalPath = target
  }

  console.log('')
  console.log(`✓ Scenario "${scenario.name}" ready at:`)
  console.log(`    ${finalPath}`)
  console.log('')
  if (scenario.contracts && scenario.contracts.length > 0) {
    console.log('  Contracts:')
    for (const c of scenario.contracts) {
      console.log(`    - ${c}`)
    }
    console.log('')
  }

  if (options.runUi) {
    console.log(`Launching \`coco ui\` against the scenario…`)
    console.log('')
    // We need TWO different paths here:
    //   - tsx + src/index.ts come from the coco repo (where bin/scenario.ts lives)
    //   - process.cwd() inside `coco ui` must be the scenario dir
    //     (the handler reads cwd to locate the repo; `--path` on `coco ui`
    //     is the history filter, NOT a "use this directory" flag).
    // So: resolve absolute paths to tsx + index.ts, then spawn with
    // cwd: finalPath. That keeps tsx happy and points coco at the
    // scenario repo.
    const cocoRepoRoot = path.resolve(__dirname, '..')
    const tsxBin = path.join(
      cocoRepoRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
    )
    const cocoEntry = path.join(cocoRepoRoot, 'src', 'index.ts')
    const result = spawnSync(tsxBin, [cocoEntry, 'ui'], {
      stdio: 'inherit',
      cwd: finalPath,
    })
    if (result.status !== 0 && result.status !== null) {
      // Non-zero exit on quit (q / Ctrl+C) is normal for Ink TUIs; only
      // warn if it's a setup-level failure.
      if (result.status > 1) {
        console.warn(`coco ui exited with status ${result.status}`)
      }
    }
  }

  if (options.ephemeral) {
    await repo.cleanup()
    console.log('')
    console.log('  (ephemeral — scenario directory has been removed)')
  } else {
    console.log('')
    console.log('  When you\'re done, clean up with:')
    console.log(`    rm -rf ${finalPath}`)
    console.log('')
  }

  return 0
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2))

  if (!command || command === 'help' || flags.help) {
    printHelp()
    process.exit(0)
  }

  if (command === 'list') {
    commandList()
    process.exit(0)
  }

  if (command === 'describe') {
    const name = positional[0]
    if (!name) {
      console.error('Missing scenario name. Try `npm run scenario list`.')
      process.exit(2)
    }
    process.exit(commandDescribe(name))
  }

  if (command === 'create') {
    const name = positional[0]
    if (!name) {
      console.error('Missing scenario name. Try `npm run scenario list`.')
      process.exit(2)
    }
    const code = await commandCreate(name, {
      targetPath: typeof flags.path === 'string' ? flags.path : undefined,
      runUi: Boolean(flags['run-ui']),
      ephemeral: Boolean(flags.ephemeral),
    })
    process.exit(code)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
