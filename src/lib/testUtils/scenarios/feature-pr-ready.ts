/**
 * `feature-pr-ready` — a feature branch with 4 commits, clean worktree,
 * ready to open a pull request against `main`.
 *
 * State after setup:
 *   - `main`  has 3 commits (initial scaffold + 2 baseline)
 *   - `feat/widget-v2` is checked out, 4 commits ahead of `main`
 *   - worktree is clean
 *   - no remote configured (the consumer can add a stub remote if it
 *     needs to test gh-CLI integrations; the scenario keeps remote
 *     setup out of scope so it works in fully-offline contexts)
 *
 * Used to validate the create-pr flow (#905) and changelog view (#906).
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import type { Scenario } from './types'
import { writeSeededFiles } from './shared/seededFiles'

const SEED = 0xfeedc0de

export const featurePrReadyScenario: Scenario = {
  name: 'feature-pr-ready',
  summary: 'feature branch with 4 commits, clean worktree, ready to open a PR',
  description: [
    'A feature branch ready to be PR\'d. `main` has 3 scaffold commits,',
    '`feat/widget-v2` is checked out and 4 commits ahead. Worktree is',
    'clean — no staged or unstaged changes.',
    '',
    'Useful for testing:',
    '  - create-pr flow (`C` keystroke) — title + body seeded from changelog',
    '  - changelog view (`L` keystroke) — exercises `--branch main` path',
    '  - branches view — exercises the feat branch divergence display',
    '  - history view — exercises commit list rendering on a non-main branch',
  ].join('\n'),
  kind: 'branch',
  contracts: [
    'main has 3 commits',
    'feat/widget-v2 is checked out',
    'feat/widget-v2 is 4 commits ahead of main',
    'worktree is clean',
  ],
  setup: async (repo) => {
    // === main: 3-commit scaffold ===
    await repo.writeFile('README.md', '# Widget\n\nA hypothetical widget library.\n')
    await repo.writeFile('package.json', JSON.stringify({
      name: 'widget',
      version: '0.1.0',
      main: 'src/index.ts',
    }, null, 2) + '\n')
    await repo.commitAll('chore: initial commit')

    await writeSeededFiles(repo, [
      { path: 'src/index.ts', tokens: 60 },
      { path: 'src/widget.ts', tokens: 120 },
    ], SEED)
    await repo.commitAll('feat: scaffold widget module')

    await writeSeededFiles(repo, [
      { path: 'src/utils.ts', tokens: 80 },
      { path: 'tests/widget.test.ts', tokens: 100 },
    ], SEED)
    await repo.commitAll('test: add baseline widget tests')

    // === feat/widget-v2: 4 commits ahead ===
    await repo.git.checkoutLocalBranch('feat/widget-v2')

    // Per-commit seed shifts so files re-touched across commits
    // (e.g. src/index.ts) actually differ between commits — same path
    // + same SEED would produce identical content and the commit would
    // be a no-op.
    // Commit 1 — feature: add v2 entry point + types
    await writeSeededFiles(repo, [
      { path: 'src/widget-v2.ts', tokens: 180 },
      { path: 'src/types.ts', tokens: 70 },
    ], SEED + 1)
    await repo.commitAll('feat: add widget-v2 entry point and types')

    // Commit 2 — feature: wire v2 into the index
    await writeSeededFiles(repo, [
      { path: 'src/index.ts', tokens: 90 },
    ], SEED + 2)
    await repo.commitAll('feat: expose widget-v2 from public index')

    // Commit 3 — tests: cover v2
    await writeSeededFiles(repo, [
      { path: 'tests/widget-v2.test.ts', tokens: 140 },
    ], SEED + 3)
    await repo.commitAll('test: cover widget-v2 happy path and edge cases')

    // Commit 4 — docs: update readme + add migration guide
    await repo.writeFile('README.md', [
      '# Widget',
      '',
      'A hypothetical widget library.',
      '',
      '## v2 (new!)',
      '',
      'The v2 API is a drop-in upgrade with structured option objects',
      'and async lifecycle hooks. See `MIGRATING.md` for details.',
      '',
    ].join('\n'))
    await repo.writeFile('MIGRATING.md', [
      '# Migrating from v1 to v2',
      '',
      'The v1 positional-args API is replaced by an options object.',
      'Lifecycle hooks are async-by-default — wrap calls in `await`.',
      '',
    ].join('\n'))
    await repo.commitAll('docs: document widget-v2 API and migration path')
  },
}
