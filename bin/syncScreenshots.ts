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

const REPO_ROOT = resolve(__dirname, '..')
const SCREENSHOTS_DIR = join(REPO_ROOT, '.screenshots')
const WWW_PUBLIC = join(REPO_ROOT, '.www', 'public', 'screenshots')

/**
 * Recipes that produce assets used on the marketing site.
 * This is the canonical list — if a recipe isn't here, it won't
 * be synced to .www even if it exists in the recipe catalog.
 */
const SITE_RECIPES = [
  // Hero GIFs
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
  // Theme carousel (all built-in color themes — kept in sync with .www/src/config/themes.ts)
  'ui-history-theme-catppuccin',
  'ui-history-theme-gruvbox',
  'ui-history-theme-dracula',
  'ui-history-theme-nord',
  'ui-history-theme-tokyo-night',
  'ui-history-theme-one-dark',
  'ui-history-theme-rose-pine',
  'ui-history-theme-kanagawa',
  'ui-history-theme-everforest',
  'ui-history-theme-monokai',
  'ui-history-theme-synthwave',
  'ui-history-theme-ayu-dark',
  'ui-history-theme-palenight',
  'ui-history-theme-github-dark',
  'ui-history-theme-horizon',
  'ui-history-theme-nightfox',
  'ui-history-theme-carbonfox',
  'ui-history-theme-tokyonight-storm',
  'ui-history-theme-iceberg',
  'ui-history-theme-material-ocean',
  'ui-history-theme-moonlight',
  'ui-history-theme-poimandres',
  'ui-history-theme-vitesse-dark',
  'ui-history-theme-vesper',
  'ui-history-theme-flexoki',
  'ui-history-theme-mellow',
  'ui-history-theme-solarized-dark',
  'ui-history-theme-solarized-light',
  'ui-history-theme-catppuccin-latte',
  'ui-history-theme-github-light',
  'ui-history-theme-monochrome',
  'ui-history-theme-night-owl',
  'ui-history-theme-cobalt2',
  'ui-history-theme-oceanic-next',
  'ui-history-theme-catppuccin-macchiato',
  'ui-history-theme-gruvbox-light',
  'ui-history-theme-tokyo-night-day',
  'ui-history-theme-one-light',
  'ui-history-theme-ayu-light',
  'ui-history-theme-rose-pine-dawn',
  'ui-history-theme-everforest-light',
  'ui-history-theme-vitesse-light',
  'ui-history-theme-dayfox',
  'ui-history-theme-night-owl-light',
  'ui-history-theme-flexoki-light',
  'ui-history-theme-material-lighter',
  'ui-history-theme-papercolor-light',
  'ui-history-theme-modus-operandi',
  'ui-history-theme-quiet-light',
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
  // Themed-view showcase — diff + status across a curated theme set
  'ui-diff-theme-catppuccin',
  'ui-diff-theme-gruvbox',
  'ui-diff-theme-dracula',
  'ui-diff-theme-tokyo-night',
  'ui-diff-theme-nord',
  'ui-diff-theme-rose-pine',
  'ui-diff-theme-github-light',
  'ui-diff-theme-catppuccin-latte',
  'ui-status-theme-catppuccin',
  'ui-status-theme-gruvbox',
  'ui-status-theme-dracula',
  'ui-status-theme-tokyo-night',
  'ui-status-theme-nord',
  'ui-status-theme-rose-pine',
  'ui-status-theme-github-light',
  'ui-status-theme-catppuccin-latte',
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
  'ui-history-pr-ready': ['workstation-history.png', 'view-pull-request.png', 'view-pr-triage.png', 'view-issues.png'],
  'ui-conflicts-merge': ['view-conflicts.png'],
  'ui-reflog': ['view-reflog.png'],
  'ui-bisect-view': ['view-bisect.png'],
  'ui-submodules-view': ['view-submodules.png'],
  'ui-changelog': ['view-changelog.png'],
  'ui-help-overlay': ['workstation-help.png'],
  'ui-history-theme-catppuccin': ['theme-catppuccin.png'],
  'ui-history-theme-gruvbox': ['theme-gruvbox.png'],
  'ui-history-theme-dracula': ['theme-dracula.png'],
  'ui-history-theme-nord': ['theme-nord.png'],
  'ui-history-theme-tokyo-night': ['theme-tokyo-night.png'],
  'ui-history-theme-one-dark': ['theme-one-dark.png'],
  'ui-history-theme-rose-pine': ['theme-rose-pine.png'],
  'ui-history-theme-kanagawa': ['theme-kanagawa.png'],
  'ui-history-theme-everforest': ['theme-everforest.png'],
  'ui-history-theme-monokai': ['theme-monokai.png'],
  'ui-history-theme-synthwave': ['theme-synthwave.png'],
  'ui-history-theme-ayu-dark': ['theme-ayu-dark.png'],
  'ui-history-theme-palenight': ['theme-palenight.png'],
  'ui-history-theme-github-dark': ['theme-github-dark.png'],
  'ui-history-theme-horizon': ['theme-horizon.png'],
  'ui-history-theme-nightfox': ['theme-nightfox.png'],
  'ui-history-theme-carbonfox': ['theme-carbonfox.png'],
  'ui-history-theme-tokyonight-storm': ['theme-tokyonight-storm.png'],
  'ui-history-theme-iceberg': ['theme-iceberg.png'],
  'ui-history-theme-material-ocean': ['theme-material-ocean.png'],
  'ui-history-theme-moonlight': ['theme-moonlight.png'],
  'ui-history-theme-poimandres': ['theme-poimandres.png'],
  'ui-history-theme-vitesse-dark': ['theme-vitesse-dark.png'],
  'ui-history-theme-vesper': ['theme-vesper.png'],
  'ui-history-theme-flexoki': ['theme-flexoki.png'],
  'ui-history-theme-mellow': ['theme-mellow.png'],
  'ui-history-theme-solarized-dark': ['theme-solarized-dark.png'],
  'ui-history-theme-solarized-light': ['theme-solarized-light.png'],
  'ui-history-theme-catppuccin-latte': ['theme-catppuccin-latte.png'],
  'ui-history-theme-github-light': ['theme-github-light.png'],
  'ui-history-theme-monochrome': ['theme-monochrome.png'],
  'ui-history-theme-night-owl': ['theme-night-owl.png'],
  'ui-history-theme-cobalt2': ['theme-cobalt2.png'],
  'ui-history-theme-oceanic-next': ['theme-oceanic-next.png'],
  'ui-history-theme-catppuccin-macchiato': ['theme-catppuccin-macchiato.png'],
  'ui-history-theme-gruvbox-light': ['theme-gruvbox-light.png'],
  'ui-history-theme-tokyo-night-day': ['theme-tokyo-night-day.png'],
  'ui-history-theme-one-light': ['theme-one-light.png'],
  'ui-history-theme-ayu-light': ['theme-ayu-light.png'],
  'ui-history-theme-rose-pine-dawn': ['theme-rose-pine-dawn.png'],
  'ui-history-theme-everforest-light': ['theme-everforest-light.png'],
  'ui-history-theme-vitesse-light': ['theme-vitesse-light.png'],
  'ui-history-theme-dayfox': ['theme-dayfox.png'],
  'ui-history-theme-night-owl-light': ['theme-night-owl-light.png'],
  'ui-history-theme-flexoki-light': ['theme-flexoki-light.png'],
  'ui-history-theme-material-lighter': ['theme-material-lighter.png'],
  'ui-history-theme-papercolor-light': ['theme-papercolor-light.png'],
  'ui-history-theme-modus-operandi': ['theme-modus-operandi.png'],
  'ui-history-theme-quiet-light': ['theme-quiet-light.png'],
  'workspace-multi-repo': ['workspace-multi-repo.png'],
  'ui-command-palette': ['feature-palette.png'],
  'ui-theme-picker': ['theme-picker.png'],
  'ui-search-filter': ['docs-search.png'],
  'ui-inspector-focused': ['workstation-history.png'],
  'demo-workstation-tour': ['demo-workstation-tour.gif'],
  'demo-ui-view-switching': ['demo-ui-view-switching.gif'],
  'demo-hunk-staging': ['demo-hunk-staging.gif'],
  'demo-search-filter': ['demo-search-filter.gif'],
  'demo-workspace-add-repo': ['demo-workspace-add-repo.gif'],
  'demo-workspace-clone': ['demo-workspace-clone.gif'],
  'demo-workstation-using': ['demo-workstation-using.gif'],
  'ui-diff-theme-catppuccin': ['diff-theme-catppuccin.png'],
  'ui-diff-theme-gruvbox': ['diff-theme-gruvbox.png'],
  'ui-diff-theme-dracula': ['diff-theme-dracula.png'],
  'ui-diff-theme-tokyo-night': ['diff-theme-tokyo-night.png'],
  'ui-diff-theme-nord': ['diff-theme-nord.png'],
  'ui-diff-theme-rose-pine': ['diff-theme-rose-pine.png'],
  'ui-diff-theme-github-light': ['diff-theme-github-light.png'],
  'ui-diff-theme-catppuccin-latte': ['diff-theme-catppuccin-latte.png'],
  'ui-status-theme-catppuccin': ['status-theme-catppuccin.png'],
  'ui-status-theme-gruvbox': ['status-theme-gruvbox.png'],
  'ui-status-theme-dracula': ['status-theme-dracula.png'],
  'ui-status-theme-tokyo-night': ['status-theme-tokyo-night.png'],
  'ui-status-theme-nord': ['status-theme-nord.png'],
  'ui-status-theme-rose-pine': ['status-theme-rose-pine.png'],
  'ui-status-theme-github-light': ['status-theme-github-light.png'],
  'ui-status-theme-catppuccin-latte': ['status-theme-catppuccin-latte.png'],
}

function main() {
  console.log('🖼️  Regenerating marketing site screenshots...\n')

  // Clean .screenshots/
  if (existsSync(SCREENSHOTS_DIR)) {
    rmSync(SCREENSHOTS_DIR, { recursive: true })
  }

  // Generate all site recipes
  let succeeded = 0
  let failed = 0

  for (const recipe of SITE_RECIPES) {
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
  for (const recipe of SITE_RECIPES) {
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
    }
  }

  console.log(`📦 Synced ${synced} files to .www/public/screenshots/`)
  console.log('   Run `cd .www && yarn dev` to preview.')
}

main()
