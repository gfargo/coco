#!/usr/bin/env tsx
/**
 * Screenshot driver — produces high-fidelity PNG / GIF captures of the
 * coco TUI for documentation, marketing, and visual regression checks.
 *
 *   - Spins up deterministic git states from `@gfargo/git-scenarios`
 *   - Generates VHS tape files describing the keystroke sequence
 *   - Hands the tape to the `vhs` CLI which drives a real PTY and
 *     captures the rendered output via xterm.js + headless browser
 *
 * Usage:
 *
 *   npm run screenshot                       # capture all recipes
 *   npm run screenshot -- --recipe ui-history-pr-ready
 *   npm run screenshot -- --list             # list available recipes
 *   npm run screenshot -- --recipe foo --keep-tape  # leave tape file behind
 *
 * Requires `vhs` (https://github.com/charmbracelet/vhs) on PATH:
 *   brew install vhs
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fromScenario, listRegistered } from '@gfargo/git-scenarios'
import { findRecipe, listRecipeNames, RECIPES, type ScreenshotRecipe } from './screenshot/recipes'
import { buildTape } from './screenshot/tape'

const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOTS_DIR = join(REPO_ROOT, '.screenshots')
const COCO_CLI = `npx tsx ${join(REPO_ROOT, 'src', 'index.ts')}`

type CliArgs = {
  list: boolean
  help: boolean
  recipe: string | undefined
  keepTape: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    list: false,
    help: false,
    recipe: undefined,
    keepTape: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--list' || arg === '-l') args.list = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--keep-tape') args.keepTape = true
    else if (arg === '--recipe' || arg === '-r') {
      args.recipe = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--recipe=')) {
      args.recipe = arg.slice('--recipe='.length)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`coco screenshot — capture high-fidelity TUI screenshots via VHS

Usage:
  npm run screenshot                              capture all recipes
  npm run screenshot -- --recipe <name>           capture one recipe
  npm run screenshot -- --list                    list available recipes
  npm run screenshot -- --keep-tape               keep the .tape file after capture

Options:
  -r, --recipe <name>    Capture a single recipe by name
  -l, --list             Print every recipe name + description
      --keep-tape        Don't delete the generated .tape file (for debugging)
  -h, --help             Show this help

Output: .screenshots/<recipe-name>.png (and .gif when emitGif is true).
Requires: vhs on PATH (https://github.com/charmbracelet/vhs).`)
}

function checkVhsAvailable(): boolean {
  const result = spawnSync('vhs', ['--version'], { stdio: 'pipe' })
  return result.status === 0
}

/**
 * Spin up the named scenario into a temp git repo and return the path
 * + a cleanup callback. Returns a temp dir with no scenario applied
 * when `scenarioName` is `null` (for recipes that don't need git
 * state, e.g. `--help` captures).
 */
async function spinUpAsync(scenarioName: string | null): Promise<{ path: string; cleanup: () => Promise<void> | void }> {
  if (!scenarioName) {
    const dir = mkdtempSync(join(tmpdir(), 'coco-screenshot-'))
    return {
      path: dir,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    }
  }

  // `fromScenario(name, ...extraSteps)` does the lookup + apply in
  // one call; we pass no extra steps so the scenario lands in its
  // canonical state. Throws helpfully if the name is unknown.
  const known = listRegistered().some((entry) => entry.name === scenarioName)
  if (!known) {
    const available = listRegistered().map((s) => s.name).join(', ')
    throw new Error(
      `Unknown scenario "${scenarioName}". Available: ${available}`
    )
  }

  const repo = await fromScenario(scenarioName)
  return {
    path: repo.path,
    cleanup: () => repo.cleanup(),
  }
}

async function runRecipe(recipe: ScreenshotRecipe, options: { keepTape: boolean }): Promise<void> {
  console.log(`▸ ${recipe.name} — ${recipe.description}`)

  const repo = await spinUpAsync(recipe.scenario)
  const tapePath = join(SCREENSHOTS_DIR, `${recipe.name}.tape`)
  const pngPath = join(SCREENSHOTS_DIR, `${recipe.name}.png`)
  const gifPath = recipe.emitGif ? join(SCREENSHOTS_DIR, `${recipe.name}.gif`) : undefined

  try {
    const tape = buildTape(recipe, {
      cwd: repo.path,
      outputPng: pngPath,
      outputGif: gifPath,
      cocoCommand: COCO_CLI,
    })
    writeFileSync(tapePath, tape, 'utf8')

    const result = spawnSync('vhs', [tapePath], {
      stdio: 'inherit',
      env: { ...process.env, NO_COLOR: process.env.NO_COLOR },
    })

    if (result.status !== 0) {
      throw new Error(`vhs exited with status ${result.status} for recipe ${recipe.name}`)
    }

    console.log(`  ✓ ${pngPath}`)
    if (gifPath) console.log(`  ✓ ${gifPath}`)
  } finally {
    if (!options.keepTape && existsSync(tapePath)) {
      rmSync(tapePath, { force: true })
    }
    await repo.cleanup()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  if (args.list) {
    console.log('Available recipes:\n')
    for (const recipe of RECIPES) {
      const themeNote = recipe.theme ? ` [${recipe.theme}]` : ''
      const gifNote = recipe.emitGif ? ' (+ gif)' : ''
      console.log(`  ${recipe.name}${themeNote}${gifNote}`)
      console.log(`    ${recipe.description}`)
    }
    console.log(`\nTotal: ${RECIPES.length} recipes`)
    return
  }

  if (!checkVhsAvailable()) {
    console.error('Error: `vhs` not found on PATH.')
    console.error('Install with: brew install vhs')
    console.error('See: https://github.com/charmbracelet/vhs')
    process.exit(1)
  }

  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }

  const targets = args.recipe
    ? [findRecipe(args.recipe)].filter((r): r is ScreenshotRecipe => Boolean(r))
    : RECIPES

  if (args.recipe && targets.length === 0) {
    console.error(`Error: unknown recipe "${args.recipe}".`)
    console.error(`Available: ${listRecipeNames().join(', ')}`)
    process.exit(1)
  }

  let succeeded = 0
  let failed = 0
  for (const recipe of targets) {
    try {
      await runRecipe(recipe, { keepTape: args.keepTape })
      succeeded += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  ✗ ${recipe.name}: ${message}`)
    }
  }

  console.log(`\n${succeeded} succeeded, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Fatal: ${message}`)
  process.exit(1)
})
