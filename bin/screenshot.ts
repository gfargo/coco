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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fromScenario, listRegistered } from '@gfargo/git-scenarios'
import { findRecipe, listRecipeNames, RECIPES, type ScreenshotRecipe } from './screenshot/recipes'
import { buildTape } from './screenshot/tape'

const REPO_ROOT = resolve(__dirname, '..')

// Load .env file from the project root so API keys (OPENAI_API_KEY,
// ANTHROPIC_API_KEY, etc.) are available to the VHS shell without
// requiring the user to export them in their terminal session.
// Supports KEY=VALUE format, ignores comments and blank lines.
function loadDotEnv(): void {
  const envPath = join(REPO_ROOT, '.env')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // Don't override existing env vars (user's shell takes precedence)
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadDotEnv()

// If GH_TOKEN isn't set (from .env or shell), try to get it from
// `gh auth token` so the workspace command can show PR counts.
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  try {
    const result = spawnSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (result.status === 0 && result.stdout.trim()) {
      process.env.GH_TOKEN = result.stdout.trim()
    }
  } catch {
    // gh not installed or not authenticated — skip silently
  }
}

const SCREENSHOTS_DIR = join(REPO_ROOT, '.screenshots')
const COCO_CLI = join(REPO_ROOT, 'node_modules', '.bin', 'tsx') + ' ' + join(REPO_ROOT, 'src', 'index.ts')
const NODE_BIN_DIR = dirname(process.execPath)

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
      path: realpathSync(dir),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    }
  }

  // Special multi-repo workspace scenario: creates 3 repos in
  // subdirectories of a parent dir for the workspace command to scan.
  if (scenarioName === '_workspace') {
    const { mkdirSync: mkdirSyncFs } = await import('fs')
    const parentDir = mkdtempSync(join(tmpdir(), 'coco-workspace-'))
    const realParent = realpathSync(parentDir)

    // Create 3 repos as subdirectories
    const scenarios = ['feature-pr-ready', 'dirty-many-files', 'stashed-changes']
    const repos: Array<{ cleanup: () => void }> = []
    for (let i = 0; i < scenarios.length; i++) {
      const repo = await fromScenario(scenarios[i])
      const targetDir = join(realParent, ['widget-app', 'dashboard', 'api-server'][i])
      mkdirSyncFs(targetDir, { recursive: true })
      const { execSync } = await import('child_process')
      execSync(`cp -a ${repo.path}/. ${targetDir}/`)
      repos.push(repo)
    }

    return {
      path: realParent,
      cleanup: async () => {
        for (const r of repos) await r.cleanup()
        rmSync(realParent, { recursive: true, force: true })
      },
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
    // Resolve symlinks (macOS /var → /private/var) so git's
    // safe.directory checks and path comparisons work correctly
    // inside VHS's isolated shell.
    path: realpathSync(repo.path),
    cleanup: () => repo.cleanup(),
  }
}

async function runRecipe(recipe: ScreenshotRecipe, options: { keepTape: boolean }): Promise<void> {
  console.log(`▸ ${recipe.name} — ${recipe.description}`)

  const repo = await spinUpAsync(recipe.scenario)
  const tapePath = join(SCREENSHOTS_DIR, `${recipe.name}.tape`)
  const pngPath = join(SCREENSHOTS_DIR, `${recipe.name}.png`)
  const gifPath = recipe.emitGif ? join(SCREENSHOTS_DIR, `${recipe.name}.gif`) : undefined

  // GitHub-integration recipes: give the scenario repo an `origin` that
  // coco recognizes as a GitHub remote, and stage a deterministic mock
  // `gh` on a temp dir we prepend to PATH (so the PR / triage / issues
  // views render canned data instead of hitting the real CLI).
  let ghMockDir: string | undefined
  if (recipe.githubRemote || recipe.ghMock) {
    const { execSync } = await import('child_process')
    if (recipe.githubRemote) {
      execSync(
        `git -C "${repo.path}" remote add origin "${recipe.githubRemote}" 2>/dev/null || git -C "${repo.path}" remote set-url origin "${recipe.githubRemote}"`,
        { stdio: 'ignore' }
      )
    }
    if (recipe.ghMock) {
      const { copyFileSync, chmodSync } = await import('fs')
      ghMockDir = mkdtempSync(join(tmpdir(), 'coco-gh-mock-'))
      const dest = join(ghMockDir, 'gh')
      copyFileSync(join(REPO_ROOT, 'bin', 'screenshot', 'mock-gh'), dest)
      chmodSync(dest, 0o755)
    }
  }

  try {
    const tape = buildTape(recipe, {
      cwd: repo.path,
      outputPng: pngPath,
      outputGif: gifPath,
      cocoCommand: COCO_CLI,
      repoRoot: REPO_ROOT,
      nodeBinDir: NODE_BIN_DIR,
      ghMockDir,
    })
    writeFileSync(tapePath, tape, 'utf8')

    const result = spawnSync('vhs', [tapePath], {
      stdio: 'inherit',
      // Run VHS from the scenario dir so `Screenshot screenshot.png`
      // lands there (VHS resolves relative paths from its cwd).
      cwd: repo.path,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    })

    if (result.status !== 0) {
      throw new Error(`vhs exited with status ${result.status} for recipe ${recipe.name}`)
    }

    // Move the screenshot from the scenario temp dir to the final
    // output location. VHS's Screenshot command only supports bare
    // filenames (no absolute paths), so we capture to `screenshot.png`
    // in the cwd and relocate here.
    const { renameSync, copyFileSync } = await import('fs')
    const capturedPath = join(repo.path, 'screenshot.png')
    if (existsSync(capturedPath)) {
      try {
        renameSync(capturedPath, pngPath)
      } catch {
        // Cross-device rename fails; fall back to copy + delete.
        copyFileSync(capturedPath, pngPath)
        rmSync(capturedPath, { force: true })
      }
    } else {
      throw new Error(
        `VHS did not produce screenshot.png in ${repo.path} for recipe ${recipe.name}. ` +
        `Ensure ffmpeg + x265 are installed: brew reinstall x265`
      )
    }

    console.log(`  ✓ ${pngPath}`)
    if (gifPath) console.log(`  ✓ ${gifPath}`)
  } finally {
    if (!options.keepTape && existsSync(tapePath)) {
      rmSync(tapePath, { force: true })
    }
    if (ghMockDir) {
      rmSync(ghMockDir, { recursive: true, force: true })
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
