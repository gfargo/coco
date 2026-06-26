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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fromScenario, listRegistered } from '@gfargo/git-scenarios'
// Side-effect import: registers screenshot-only custom scenarios into the
// git-scenarios registry before any `fromScenario` / `listRegistered` call.
import './screenshot/scenarios'
import { findRecipe, listRecipeNames, RECIPES, type ScreenshotRecipe } from './screenshot/recipes'
import { buildTape, createSecretRedactor, hasForwardedSecrets } from './screenshot/tape'

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
// Use the built dist/ output instead of tsx for near-instant startup.
// tsx cold-starts at 2-3s inside VHS; the compiled JS starts in <200ms.
// Run `npm run build` before `npm run screenshot` if dist/ is stale.
const COCO_CLI = 'node ' + join(REPO_ROOT, 'dist', 'index.js')
const NODE_BIN_DIR = dirname(process.execPath)

/**
 * Default gifsicle `--lossy` level applied during optimization. Gentle
 * (30) — high enough to let consecutive near-identical terminal frames
 * collapse into a single frame (the dominant size win; see optimizeGif),
 * low enough to stay visually lossless on crisp monospace text. Override
 * per-run with `--lossy <n>`; disable with `--lossless`.
 */
const DEFAULT_GIF_LOSSY = 30

type CliArgs = {
  list: boolean
  help: boolean
  recipe: string | undefined
  keepTape: boolean
  /** gifsicle `--lossy` level; 0 means lossless (`-O3` only). */
  gifLossy: number
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    list: false,
    help: false,
    recipe: undefined,
    keepTape: false,
    gifLossy: DEFAULT_GIF_LOSSY,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--list' || arg === '-l') args.list = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--keep-tape') args.keepTape = true
    else if (arg === '--lossless') args.gifLossy = 0
    else if (arg === '--lossy') {
      args.gifLossy = Number(argv[i + 1])
      i += 1
    } else if (arg.startsWith('--lossy=')) {
      args.gifLossy = Number(arg.slice('--lossy='.length))
    } else if (arg === '--recipe' || arg === '-r') {
      args.recipe = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--recipe=')) {
      args.recipe = arg.slice('--recipe='.length)
    }
  }
  if (!Number.isFinite(args.gifLossy) || args.gifLossy < 0) {
    args.gifLossy = DEFAULT_GIF_LOSSY
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
      --lossy <n>        gifsicle --lossy level for GIF shrink (default ${DEFAULT_GIF_LOSSY})
      --lossless         Disable lossy GIF shrink (gifsicle -O3 only)
  -h, --help             Show this help

Output: .screenshots/<recipe-name>.png (and .gif when emitGif is true).
GIFs are shrunk with gifsicle -O3 --lossy=${DEFAULT_GIF_LOSSY} (visually lossless on
terminal text; collapses duplicate sleep-frames). Requires: vhs + gifsicle on PATH.`)
}

function checkVhsAvailable(): boolean {
  const result = spawnSync('vhs', ['--version'], { stdio: 'pipe' })
  return result.status === 0
}

/**
 * Count the frames in a GIF via `gifsicle --info` ("<n> images" on the
 * header line). Best-effort: returns null if gifsicle/parse fails — the
 * count is only used for a log line, never for control flow.
 */
function countGifFrames(gifPath: string): number | null {
  const result = spawnSync('gifsicle', ['--info', gifPath], { encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) return null
  const match = result.stdout.match(/(\d+) images/)
  return match ? Number(match[1]) : null
}

/**
 * Shrink a VHS-captured GIF. VHS writes full, undeduplicated frames at
 * its capture framerate, so a short terminal demo lands at 10–30 MB —
 * mostly *duplicate* frames painted during the `Sleep` beats while
 * nothing on screen changes.
 *
 * `gifsicle -O3` alone can't merge those duplicates: sub-pixel dithering
 * noise leaves consecutive "static" frames not-quite-identical, so all of
 * them survive (a 7s demo stays 180+ frames / ~28 MB). A gentle
 * `--lossy=<level>` pass quantizes that noise away, which lets `-O3`
 * collapse each run of now-identical frames into ONE frame with an
 * extended delay — timing preserved, only the genuinely-distinct visual
 * states kept. On terminal captures this is the dominant lever (~100×),
 * and at level 30 it's visually lossless on monospace text.
 *
 * `lossy === 0` keeps the old lossless-only behaviour (`--lossless` flag).
 *
 * Best-effort: if `gifsicle` isn't on PATH we leave the raw GIF in place
 * and print an install hint rather than failing the capture. Optimizing
 * in the pipeline (not by hand) means `screenshot:sync` regenerations
 * stay small without anyone remembering a post-step.
 */
function optimizeGif(gifPath: string, lossy: number): void {
  const probe = spawnSync('gifsicle', ['--version'], { stdio: 'pipe' })
  if (probe.status !== 0) {
    console.log('  · gifsicle not found — GIF left unoptimized (brew install gifsicle)')
    return
  }
  const before = existsSync(gifPath) ? statSync(gifPath).size : 0
  const framesBefore = countGifFrames(gifPath)
  const gifsicleArgs = lossy > 0
    ? ['-O3', `--lossy=${lossy}`, '--batch', gifPath]
    : ['-O3', '--batch', gifPath]
  const result = spawnSync('gifsicle', gifsicleArgs, { stdio: 'pipe' })
  if (result.status !== 0) {
    console.log('  · gifsicle optimization failed — GIF left unoptimized')
    return
  }
  const after = statSync(gifPath).size
  const framesAfter = countGifFrames(gifPath)
  const mb = (n: number) => (n / 1048576).toFixed(2)
  const mode = lossy > 0 ? `--lossy=${lossy}` : 'lossless'
  const frames = framesBefore != null && framesAfter != null
    ? ` (${framesBefore} → ${framesAfter} frames)`
    : ''
  console.log(`  · gifsicle -O3 ${mode}: ${mb(before)} MB → ${mb(after)} MB${frames}`)
}

/**
 * Optimize a PNG with pngquant — lossy palette quantization that's
 * visually lossless on terminal screenshots (flat color blocks, sharp
 * text edges). Typically shrinks PNGs by 50-70%.
 *
 * Best-effort: if `pngquant` isn't on PATH we skip silently.
 */
function optimizePng(pngPath: string): void {
  const probe = spawnSync('pngquant', ['--version'], { stdio: 'pipe' })
  if (probe.status !== 0) {
    console.log('  · pngquant not found — PNG left unoptimized (brew install pngquant)')
    return
  }
  const before = existsSync(pngPath) ? statSync(pngPath).size : 0
  // --quality 85-100: keep quality high (terminal text is crisp)
  // --speed 1: slowest/best compression
  // --force --ext .png: overwrite in place (pngquant normally writes -fs8.png)
  const result = spawnSync('pngquant', [
    '--quality=85-100', '--speed=1', '--force', '--ext', '.png', pngPath,
  ], { stdio: 'pipe' })
  if (result.status !== 0) {
    // pngquant exits 99 if quality constraint can't be met — that's fine,
    // it means the PNG is already near-optimal.
    if (result.status !== 99) {
      console.log('  · pngquant optimization failed — PNG left as-is')
    }
    return
  }
  const after = statSync(pngPath).size
  const kb = (n: number) => (n / 1024).toFixed(0)
  console.log(`  · pngquant: ${kb(before)} KB → ${kb(after)} KB (${Math.round((1 - after / before) * 100)}% smaller)`)
}

/**
 * Convert a PNG to WebP for the marketing site. WebP is typically
 * 25-35% smaller than optimized PNG at equivalent quality. The .webp
 * file is written alongside the original (same path, .webp extension).
 *
 * Best-effort: if `cwebp` isn't on PATH we skip silently.
 */
function convertPngToWebp(pngPath: string): void {
  const probe = spawnSync('cwebp', ['-version'], { stdio: 'pipe' })
  if (probe.status !== 0) {
    // Don't warn on every file — just skip quietly. The README documents
    // the optional dependency.
    return
  }
  const webpPath = pngPath.replace(/\.png$/, '.webp')
  const result = spawnSync('cwebp', [
    '-q', '90', '-m', '6', pngPath, '-o', webpPath,
  ], { stdio: 'pipe' })
  if (result.status !== 0) return
  const pngSize = statSync(pngPath).size
  const webpSize = statSync(webpPath).size
  const kb = (n: number) => (n / 1024).toFixed(0)
  console.log(`  · webp: ${kb(pngSize)} KB → ${kb(webpSize)} KB (${Math.round((1 - webpSize / pngSize) * 100)}% smaller)`)
}

/**
 * Convert an animated GIF to animated WebP. Animated WebP is typically
 * 50-70% smaller than optimized GIF. The .webp file is written alongside
 * the original (same path, .webp extension).
 *
 * Best-effort: if `gif2webp` isn't on PATH we skip silently.
 */
function convertGifToWebp(gifPath: string): void {
  const probe = spawnSync('gif2webp', ['-version'], { stdio: 'pipe' })
  if (probe.status !== 0) return
  const webpPath = gifPath.replace(/\.gif$/, '.webp')
  const result = spawnSync('gif2webp', [
    '-q', '85', '-m', '4', '-mixed', gifPath, '-o', webpPath,
  ], { stdio: 'pipe' })
  if (result.status !== 0) return
  const gifSize = statSync(gifPath).size
  const webpSize = statSync(webpPath).size
  const kb = (n: number) => (n / 1024).toFixed(0)
  console.log(`  · webp: ${kb(gifSize)} KB → ${kb(webpSize)} KB (${Math.round((1 - webpSize / gifSize) * 100)}% smaller)`)
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

async function runRecipe(recipe: ScreenshotRecipe, options: { keepTape: boolean; gifLossy: number }): Promise<void> {
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

  // GitLab-integration recipes: same idea as the gh block, but the origin is a
  // GitLab host (so coco routes through `glab`) and we stage a mock `glab`.
  let glabMockDir: string | undefined
  if (recipe.gitlabRemote || recipe.glabMock) {
    const { execSync } = await import('child_process')
    if (recipe.gitlabRemote) {
      execSync(
        `git -C "${repo.path}" remote add origin "${recipe.gitlabRemote}" 2>/dev/null || git -C "${repo.path}" remote set-url origin "${recipe.gitlabRemote}"`,
        { stdio: 'ignore' }
      )
    }
    if (recipe.glabMock) {
      const { copyFileSync, chmodSync } = await import('fs')
      glabMockDir = mkdtempSync(join(tmpdir(), 'coco-glab-mock-'))
      const dest = join(glabMockDir, 'glab')
      copyFileSync(join(REPO_ROOT, 'bin', 'screenshot', 'mock-glab'), dest)
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
      glabMockDir,
    })
    writeFileSync(tapePath, tape, 'utf8')

    // Capture VHS output (rather than `stdio: 'inherit'`) so we can mask
    // forwarded secrets before surfacing it: VHS echoes every tape
    // command it runs, including the `export OPENAI_API_KEY=…` lines, so
    // inheriting stdout would stream raw keys/tokens to the terminal.
    const redact = createSecretRedactor()
    const result = spawnSync('vhs', [tapePath], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
      // Run VHS from the scenario dir so `Screenshot screenshot.png`
      // lands there (VHS resolves relative paths from its cwd).
      cwd: repo.path,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    })
    if (result.stdout) process.stdout.write(redact(result.stdout))
    if (result.stderr) process.stderr.write(redact(result.stderr))

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
    optimizePng(pngPath)
    convertPngToWebp(pngPath)
    if (gifPath && existsSync(gifPath)) {
      optimizeGif(gifPath, options.gifLossy)
      convertGifToWebp(gifPath)
      console.log(`  ✓ ${gifPath}`)
    }
  } finally {
    if (!options.keepTape && existsSync(tapePath)) {
      rmSync(tapePath, { force: true })
    } else if (options.keepTape && existsSync(tapePath) && hasForwardedSecrets()) {
      // The tape has to embed the literal `export KEY=value` lines for
      // the in-VHS shell to pick them up, so a kept tape contains live
      // credentials in plaintext. Warn loudly rather than silently
      // leaving a secret-bearing file in `.screenshots/`.
      console.log(`  ⚠ ${tapePath} contains forwarded credentials in plaintext — delete it when done debugging.`)
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
      await runRecipe(recipe, { keepTape: args.keepTape, gifLossy: args.gifLossy })
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
