#!/usr/bin/env tsx
/**
 * CLI driver for the scenario library — spin up a fake repo in a
 * named state for manual testing.
 *
 * Usage:
 *   git-scenarios list                              # show all scenarios
 *   git-scenarios describe <name>                   # describe one
 *   git-scenarios create <name>                     # create in /tmp
 *   git-scenarios create <name> --path <dir>        # create at <dir>
 *   git-scenarios create <name> --run <cmd>         # create AND launch <cmd>
 *                                                   # against the scenario dir
 *   git-scenarios create <name> --remote <url>      # add an `origin` remote
 *                                                   # (lets gh-aware tools detect
 *                                                   #  a GitHub remote on launch)
 *
 * Coco's `package.json` exposes `npm run scenario` as a shortcut.
 * `npm run scenario create X -- --run-ui` is a back-compat alias for
 * `--run "<tsx> <coco-root>/src/index.ts ui"` — it knows how to find
 * coco from its monorepo location. When this package ships standalone,
 * `--run-ui` goes away and external consumers use `--run "coco ui"` (or
 * any other shell command) instead.
 *
 * By default, `create` PERSISTS the scenario (doesn't auto-clean) —
 * that's what manual testing wants. Use `--ephemeral` to clean up on
 * exit (handy for one-shot smoke tests). The cleanup hint is printed
 * at the end either way.
 */

import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

import { allScenarios, findScenario, type Scenario } from '../src/scenarios'
import { createTempGitRepo } from '../src/tempGitRepo'

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
    '  git-scenarios — manage temp git repo states for testing',
    '',
    '  Usage:',
    '    git-scenarios list',
    '    git-scenarios describe <name>',
    '    git-scenarios create <name> [options]',
    '',
    '  Create options:',
    '    --path <dir>     Materialize the scenario at <dir> instead of /tmp',
    '    --run <cmd>      Launch <cmd> (shell string) against the scenario',
    '                     directory after creation. Examples:',
    '                       --run "lazygit"',
    '                       --run "gitui"',
    '                       --run "code -n"   (opens the dir in VS Code)',
    '    --run-ui         Coco-monorepo shortcut: spawn `tsx <coco>/src/index.ts ui`',
    '                     in the scenario dir. Equivalent to `--run "coco ui"` for',
    '                     consumers outside the coco monorepo.',
    '    --remote <url>   Add `origin` pointing at <url> so gh-aware tools detect',
    '                     a remote on launch. Pass any gh-shaped URL — a real one',
    '                     for live data, a fake one to render the views without',
    '                     risking destructive actions against a real repo.',
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
    console.error(`Unknown scenario "${name}". Try \`git-scenarios list\`.`)
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

/**
 * Resolve the coco monorepo root from this CLI's location. Only used
 * by the `--run-ui` back-compat alias; the standalone `--run <cmd>`
 * path never reaches here.
 *
 * This file lives at:
 *   <coco-repo-root>/packages/git-scenarios/bin/cli.ts
 *
 * `__dirname` is `<coco-repo-root>/packages/git-scenarios/bin`. Two
 * levels up lands on the coco repo root where `src/index.ts` lives.
 */
function resolveCocoMonorepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..')
}

async function commandCreate(
  name: string,
  options: {
    targetPath?: string
    runCommand?: string
    runUi?: boolean
    ephemeral?: boolean
    remote?: string
  }
): Promise<number> {
  const scenario = findScenario(name)
  if (!scenario) {
    console.error(`Unknown scenario "${name}". Try \`git-scenarios list\`.`)
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

  // Optional origin remote. Scenarios default to no remote so the test
  // isolation story stays simple, but `--remote` lets manual testers
  // exercise gh-aware features against a real-shaped URL — without it,
  // those features render "No GitHub remote detected" because the bare
  // `git init` repo has no origin.
  if (options.remote) {
    try {
      await repo.git.addRemote('origin', options.remote)
    } catch (error) {
      console.error(`Failed to add origin remote: ${(error as Error).message}`)
      return 1
    }
  }

  let finalPath = repo.path
  if (options.targetPath) {
    const target = path.resolve(options.targetPath)
    // Plain rename keeps the worktree state intact and is what manual
    // testers expect when they say "put this scenario at ~/sandbox".
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

  // Launcher resolution: --run-ui is a coco-monorepo back-compat alias
  // for "spawn coco's source-tree CLI against the scenario dir"; --run
  // is the generalized form that takes any shell command. The latter is
  // what an external consumer of `@gfargo/git-scenarios` would always
  // use; the former exists because npm scripts inside coco rely on the
  // historical flag name.
  if (options.runUi) {
    console.log(`Launching \`coco ui\` against the scenario…`)
    console.log('')
    const cocoRepoRoot = resolveCocoMonorepoRoot()
    const tsxBin = path.join(
      cocoRepoRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
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
  } else if (options.runCommand) {
    console.log(`Launching \`${options.runCommand}\` against the scenario…`)
    console.log('')
    // Pass through the shell so users can write `--run "code -n"` and
    // get shell-style argument splitting. Same trade-off as `npm exec`.
    const result = spawnSync(options.runCommand, {
      shell: true,
      stdio: 'inherit',
      cwd: finalPath,
    })
    if (result.status !== 0 && result.status !== null) {
      if (result.status > 1) {
        console.warn(`${options.runCommand} exited with status ${result.status}`)
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
      console.error('Missing scenario name. Try `git-scenarios list`.')
      process.exit(2)
    }
    process.exit(commandDescribe(name))
  }

  if (command === 'create') {
    const name = positional[0]
    if (!name) {
      console.error('Missing scenario name. Try `git-scenarios list`.')
      process.exit(2)
    }
    const code = await commandCreate(name, {
      targetPath: typeof flags.path === 'string' ? flags.path : undefined,
      runCommand: typeof flags.run === 'string' ? flags.run : undefined,
      runUi: Boolean(flags['run-ui']),
      ephemeral: Boolean(flags.ephemeral),
      remote: typeof flags.remote === 'string' ? flags.remote : undefined,
    })
    process.exit(code)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
