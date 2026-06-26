#!/usr/bin/env tsx
/**
 * Regenerate all screenshots and GIFs used on the marketing site
 * (.www) and sync them to .www/public/screenshots/.
 *
 * Run after making visual changes to the workstation (themes, layout,
 * selection styling, etc.) to update the live site assets.
 *
 * Usage:
 *   npm run screenshot:sync
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'

import { getLogInkThemePresets } from '../src/workstation/chrome/theme'

const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOTS_DIR = join(REPO_ROOT, '.screenshots')
const WWW_PUBLIC = join(REPO_ROOT, '.www', 'public', 'screenshots')

/**
 * Every selectable preset except `default` has a `ui-history-theme-<preset>`
 * gallery recipe (the bare `default` is the baseline shown across the other
 * view shots, so it isn't a carousel entry). Derived from the theme source of
 * truth so the carousel — and its `.www` sync — pick up new themes for free.
 */
const THEME_HISTORY_RECIPES = getLogInkThemePresets()
  .filter((preset) => preset !== 'default')
  .map((preset) => `ui-history-theme-${preset}`)

/**
 * Recipes that produce assets used on the marketing site.
 * This is the canonical list — if a recipe isn't here, it won't
 * be synced to .www even if it exists in the recipe catalog.
 */
const SITE_RECIPES = [
  // Hero GIFs
  'demo-boot-workstation',
  'demo-commit-flow',
  'readme-commit',
  'readme-workstation',
  'demo-workstation-tour',
  'demo-ui-view-switching',
  // Workflow GIFs
  'demo-hunk-staging',
  'demo-search-filter',
  // View screenshots (used in the 16-view grid)
  'ui-history-rich-graph',
  'ui-status-dirty-worktree',
  'ui-diff-feature-branch',
  'ui-compose',
  'ui-branches-sync-showcase',
  'ui-tags',
  'ui-stash-list',
  'ui-worktrees',
  'ui-history-pr-ready',
  'ui-conflicts-merge',
  'ui-reflog',
  'ui-bisect-view',
  'ui-submodules-view',
  'ui-changelog',
  'ui-help-overlay',
  // Theme carousel (all built-in color themes — derived from the theme source
  // of truth and kept in sync with .www/src/config/themes.ts)
  ...THEME_HISTORY_RECIPES,
  // Utility
  'workspace-multi-repo',
  'ui-command-palette',
  'ui-theme-picker',
  'ui-search-filter',
  'ui-inspector-focused',
  // Workspace demos (add a repo by path, clone a remote)
  'demo-workspace-add-repo',
  'demo-workspace-clone',
  'demo-workstation-using',
  // Hunk staging
  'demo-staging-hunks',
  'ui-staging-hunks',
  // Stash workflow (rich rows + rename)
  'demo-stash-workflow',
  // Worktree-aware checkout conflict (switch / remove+checkout / remove+branch)
  'demo-checkout-worktree-conflict',
  // Motion demos for features that only had static shots
  'demo-single-pane',
  'demo-conflicts',
  'demo-bisect',
  // Single-pane fallback (narrow terminals)
  'ui-single-pane-narrow',
  'ui-single-pane-peek',
  // Feature shots that previously had no recipe
  'ui-which-key',
  'ui-view-keys',
  'demo-view-keys',
  'ui-compare-refs',
  'ui-stage-pathspec',
  // GitHub-integration views (mock-gh) — real data, no longer stubbed
  'ui-pull-request',
  'ui-pr-triage',
  'ui-issues',
  // Multi-step TOUR demos — complete-task journeys wired into Key Workflows
  // (ship / review / recover) and the Workspace section (drive many repos)
  'demo-tour-ship-change',
  'demo-tour-review-pr',
  'demo-tour-find-regression',
  'demo-tour-workspace',
]

/**
 * Map from recipe name to the filename(s) used in .www/public/screenshots/.
 * Most recipes map 1:1 (recipe-name.png), but some have custom names
 * for semantic clarity on the site.
 */
const FILENAME_MAP: Record<string, string[]> = {
  'ui-history-rich-graph': ['hero-history-graph.png', 'view-history.png'],
  'ui-status-dirty-worktree': ['feature-status.png', 'view-status.png'],
  'ui-diff-feature-branch': ['view-diff.png'],
  'ui-compose': ['view-compose.png'],
  'ui-branches-sync-showcase': ['view-branches.png'],
  'ui-tags': ['view-tags.png'],
  'ui-stash-list': ['view-stash.png'],
  'ui-worktrees': ['view-worktrees.png'],
  'ui-history-pr-ready': ['workstation-history.png'],
  // The PR / triage / issues views render real (mock-gh) data now, so they
  // back their own marketing images instead of stubbing to the history shot.
  'ui-pull-request': ['view-pull-request.png'],
  'ui-pr-triage': ['view-pr-triage.png'],
  'ui-issues': ['view-issues.png'],
  'ui-conflicts-merge': ['view-conflicts.png'],
  'ui-reflog': ['view-reflog.png'],
  'ui-bisect-view': ['view-bisect.png'],
  'ui-submodules-view': ['view-submodules.png'],
  'ui-changelog': ['view-changelog.png'],
  'ui-help-overlay': ['workstation-help.png'],
  // Theme carousel — each `ui-history-theme-<preset>` recipe maps 1:1 to
  // `theme-<preset>.png` on the site. Generated from the same derived list as
  // SITE_RECIPES so every preset's image syncs without hand-maintenance.
  ...Object.fromEntries(
    THEME_HISTORY_RECIPES.map((recipe) => [recipe, [`${recipe.replace('ui-history-', '')}.png`]]),
  ),
  'workspace-multi-repo': ['workspace-multi-repo.png'],
  'ui-command-palette': ['feature-palette.png'],
  'ui-theme-picker': ['theme-picker.png'],
  'ui-search-filter': ['docs-search.png'],
  'ui-inspector-focused': ['workstation-history.png'],
  'demo-boot-workstation': ['demo-boot-workstation.gif'],
  'demo-commit-flow': ['demo-commit-flow.gif'],
  'readme-commit': ['readme-commit.gif'],
  'readme-workstation': ['readme-workstation.gif'],
  'demo-workstation-tour': ['demo-workstation-tour.gif'],
  'demo-ui-view-switching': ['demo-ui-view-switching.gif'],
  'demo-hunk-staging': ['demo-hunk-staging.gif'],
  'demo-search-filter': ['demo-search-filter.gif'],
  'demo-workspace-add-repo': ['demo-workspace-add-repo.gif'],
  'demo-workspace-clone': ['demo-workspace-clone.gif'],
  'demo-workstation-using': ['demo-workstation-using.gif'],
  'demo-staging-hunks': ['demo-staging-hunks.gif'],
  'demo-stash-workflow': ['demo-stash-workflow.gif'],
  'demo-checkout-worktree-conflict': ['demo-checkout-worktree-conflict.gif'],
  'demo-single-pane': ['demo-single-pane.gif'],
  'demo-conflicts': ['demo-conflicts.gif'],
  'demo-bisect': ['demo-bisect.gif'],
  'demo-tour-ship-change': ['demo-tour-ship-change.gif'],
  'demo-tour-review-pr': ['demo-tour-review-pr.gif'],
  'demo-tour-find-regression': ['demo-tour-find-regression.gif'],
  'demo-tour-workspace': ['demo-tour-workspace.gif'],
  'ui-single-pane-narrow': ['single-pane-narrow.png'],
  'ui-single-pane-peek': ['single-pane-peek.png'],
  'ui-which-key': ['which-key.png'],
  'ui-view-keys': ['view-keys.png'],
  'demo-view-keys': ['demo-view-keys.gif'],
  'ui-compare-refs': ['view-compare.png'],
  'ui-stage-pathspec': ['stage-pathspec.png'],
  'ui-staging-hunks': ['staging-hunks.png'],
}

/**
 * Resolve which recipes to (re)generate + sync. With no CLI args we do
 * the full site sweep (all of SITE_RECIPES). Passing recipe names syncs
 * just those — handy after a change that only touches a view or two,
 * instead of regenerating ~150 captures. Unknown names abort with the
 * valid list so a typo doesn't silently sync nothing.
 */
function resolveTargetRecipes(argv: string[]): string[] {
  const requested = argv.filter((arg) => !arg.startsWith('-'))
  if (requested.length === 0) {
    return SITE_RECIPES
  }
  const known = new Set(SITE_RECIPES)
  const unknown = requested.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    console.error(`Unknown recipe(s): ${unknown.join(', ')}`)
    console.error('Recipes synced to the site are listed in SITE_RECIPES (bin/syncScreenshots.ts),')
    console.error('or run `npm run screenshot -- --list` for the full catalog.')
    process.exit(1)
  }
  // Preserve SITE_RECIPES order for deterministic, readable output.
  return SITE_RECIPES.filter((name) => requested.includes(name))
}

function main() {
  const targetRecipes = resolveTargetRecipes(process.argv.slice(2))
  const isSubset = targetRecipes.length !== SITE_RECIPES.length
  console.log(isSubset
    ? `🖼️  Regenerating ${targetRecipes.length} screenshot(s): ${targetRecipes.join(', ')}\n`
    : '🖼️  Regenerating marketing site screenshots...\n')

  // Full sync starts from a clean slate; a subset sync leaves the other
  // captures in place and only refreshes the requested recipes' files.
  if (!isSubset && existsSync(SCREENSHOTS_DIR)) {
    rmSync(SCREENSHOTS_DIR, { recursive: true })
  }

  // Generate the target recipes
  let succeeded = 0
  let failed = 0

  for (const recipe of targetRecipes) {
    const result = spawnSync('npm', ['run', 'screenshot', '--', '--recipe', recipe], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120_000,
    })

    if (result.status === 0) {
      succeeded++
      process.stdout.write(`  ✓ ${recipe}\n`)
    } else {
      failed++
      process.stdout.write(`  ✗ ${recipe}\n`)
      if (result.stderr) {
        process.stdout.write(`    ${result.stderr.trim().split('\n')[0]}\n`)
      }
    }
  }

  console.log(`\n${succeeded} generated, ${failed} failed.\n`)

  if (failed > 0) {
    console.log('⚠️  Some recipes failed. Syncing what succeeded.\n')
  }

  // Sync to .www/public/screenshots/
  if (!existsSync(WWW_PUBLIC)) {
    mkdirSync(WWW_PUBLIC, { recursive: true })
  }

  let synced = 0
  for (const recipe of targetRecipes) {
    const targets = FILENAME_MAP[recipe]
    if (!targets) continue

    // Find the source file (PNG or GIF)
    const pngSrc = join(SCREENSHOTS_DIR, `${recipe}.png`)
    const gifSrc = join(SCREENSHOTS_DIR, `${recipe}.gif`)

    for (const target of targets) {
      const src = target.endsWith('.gif') ? gifSrc : pngSrc
      if (!existsSync(src)) continue

      const dest = join(WWW_PUBLIC, target)
      cpSync(src, dest)
      synced++

      // Also copy the .webp variant if it exists (produced by the
      // optimization pipeline). The .webp sits next to the original
      // in .screenshots/ with the same base name but .webp extension.
      const webpSrc = src.replace(/\.(png|gif)$/, '.webp')
      if (existsSync(webpSrc)) {
        const webpDest = join(WWW_PUBLIC, target.replace(/\.(png|gif)$/, '.webp'))
        cpSync(webpSrc, webpDest)
        synced++
      }
    }
  }

  console.log(`📦 Synced ${synced} files to .www/public/screenshots/`)
  console.log('   Run `cd .www && yarn dev` to preview.')
}

main()
