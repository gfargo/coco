/**
 * `multi-commit-branch` — a small repo with a feature branch carrying
 * 8 commits of varied types (feat / fix / chore / docs / refactor /
 * test). Clean worktree. No remote. Designed as a no-frills baseline
 * for testing the workstation's general navigation, filter, palette,
 * yank, and view-switching behaviors.
 *
 * State after setup:
 *   - `main` has 2 commits
 *   - `feat/dashboard` has 8 commits on top of `main`
 *   - `feat/dashboard` is checked out
 *   - worktree is clean
 *
 * Used to validate:
 *   - history surface rendering (varied commit messages exercise the
 *     subject column truncation, ref-label display, etc.)
 *   - filter (`/`) with varied subjects
 *   - palette + chord overlays (`:` / `g x`)
 *   - yank (`y` / `Y`) from history
 *   - view switches between history / status / branches / tags
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import type { Scenario } from './types'
import { writeSeededFiles } from './shared/seededFiles'

const SEED = 0xdab0b00

const COMMIT_MESSAGES = [
  'feat: add dashboard layout',
  'feat: wire dashboard to data source',
  'test: cover dashboard reducer',
  'fix: dashboard refresh interval respects user setting',
  'refactor: extract dashboard data-fetch into hook',
  'docs: document dashboard configuration',
  'chore: bump dev dependencies',
  'feat: add dashboard export-to-csv action',
] as const

export const multiCommitBranchScenario: Scenario = {
  name: 'multi-commit-branch',
  summary: 'feature branch with 8 varied commits (feat/fix/chore/docs/refactor/test)',
  description: [
    'A `feat/dashboard` branch with 8 commits of varied types on top of',
    'a 2-commit `main`. Each commit touches a different file with',
    'deterministic seeded content, so the history surface, filter,',
    'and yank behaviors have realistic inputs to exercise.',
    '',
    'Useful for testing:',
    '  - history surface column widths (varied subject lengths)',
    '  - filter / search across commit subjects',
    '  - palette and chord overlay interactions',
    '  - view switches between history / status / branches',
    '  - yank short-hash / full-hash from a selected commit',
  ].join('\n'),
  kind: 'branch',
  contracts: [
    'main has 2 commits',
    'feat/dashboard is checked out',
    'feat/dashboard has 8 commits on top of main',
    'worktree is clean',
  ],
  setup: async (repo) => {
    // main baseline
    await repo.writeFile('README.md', '# Dashboard\n')
    await repo.commitAll('chore: initial scaffold')

    await writeSeededFiles(repo, [
      { path: 'src/app.ts', tokens: 80 },
      { path: 'src/index.ts', tokens: 50 },
    ], SEED)
    await repo.commitAll('chore: baseline app shell')

    // feature branch — 8 commits, each on its own file with a
    // distinct seed so the commit subjects actually correspond to
    // distinct diffs.
    await repo.git.checkoutLocalBranch('feat/dashboard')

    for (let i = 0; i < COMMIT_MESSAGES.length; i += 1) {
      await writeSeededFiles(repo, [
        { path: `src/dashboard/feature-${String(i + 1).padStart(2, '0')}.ts`, tokens: 80 + i * 10 },
      ], SEED + 100 + i)
      await repo.commitAll(COMMIT_MESSAGES[i])
    }
  },
}
