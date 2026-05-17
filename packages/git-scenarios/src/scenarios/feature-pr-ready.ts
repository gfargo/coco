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
 * Used to validate the create-pr flow and changelog view.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 *
 * IMPLEMENTATION NOTE: this is the first scenario migrated to the atom
 * layer (#996 follow-up). Compare against the old imperative form to
 * see how `chain` + atoms compress the per-commit boilerplate. Other
 * scenarios continue to use the imperative `(repo) => …` form until
 * they're individually migrated.
 */

import { addCommit, chain, defineScenario, seededFiles, switchToBranch } from '../atoms'

const SEED = 0xfeedc0de

export const featurePrReadyScenario = defineScenario({
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
  setup: chain(
    // === main: 3-commit scaffold ===
    addCommit({
      message: 'chore: initial commit',
      files: {
        'README.md': '# Widget\n\nA hypothetical widget library.\n',
        'package.json':
          JSON.stringify(
            { name: 'widget', version: '0.1.0', main: 'src/index.ts' },
            null,
            2,
          ) + '\n',
      },
    }),
    seededFiles({
      files: [
        { path: 'src/index.ts', tokens: 60 },
        { path: 'src/widget.ts', tokens: 120 },
      ],
      seed: SEED,
    }),
    addCommit({ message: 'feat: scaffold widget module' }),
    seededFiles({
      files: [
        { path: 'src/utils.ts', tokens: 80 },
        { path: 'tests/widget.test.ts', tokens: 100 },
      ],
      seed: SEED,
    }),
    addCommit({ message: 'test: add baseline widget tests' }),

    // === feat/widget-v2: 4 commits ahead ===
    switchToBranch('feat/widget-v2'),

    // Per-commit seed shifts so files re-touched across commits (e.g.
    // `src/index.ts`) actually differ between commits — same path +
    // same SEED would produce identical content and the commit would
    // be a no-op.

    // Commit 1 — feature: add v2 entry point + types
    seededFiles({
      files: [
        { path: 'src/widget-v2.ts', tokens: 180 },
        { path: 'src/types.ts', tokens: 70 },
      ],
      seed: SEED + 1,
    }),
    addCommit({ message: 'feat: add widget-v2 entry point and types' }),

    // Commit 2 — feature: wire v2 into the index
    seededFiles({
      files: [{ path: 'src/index.ts', tokens: 90 }],
      seed: SEED + 2,
    }),
    addCommit({ message: 'feat: expose widget-v2 from public index' }),

    // Commit 3 — tests: cover v2
    seededFiles({
      files: [{ path: 'tests/widget-v2.test.ts', tokens: 140 }],
      seed: SEED + 3,
    }),
    addCommit({ message: 'test: cover widget-v2 happy path and edge cases' }),

    // Commit 4 — docs: update readme + add migration guide
    addCommit({
      message: 'docs: document widget-v2 API and migration path',
      files: {
        'README.md': [
          '# Widget',
          '',
          'A hypothetical widget library.',
          '',
          '## v2 (new!)',
          '',
          'The v2 API is a drop-in upgrade with structured option objects',
          'and async lifecycle hooks. See `MIGRATING.md` for details.',
          '',
        ].join('\n'),
        'MIGRATING.md': [
          '# Migrating from v1 to v2',
          '',
          'The v1 positional-args API is replaced by an options object.',
          'Lifecycle hooks are async-by-default — wrap calls in `await`.',
          '',
        ].join('\n'),
      },
    }),
  ),
})
