/**
 * `submodule-with-history` — a parent repo that registers a single
 * submodule (`vendor/lib`), where both sides have real commit history.
 *
 * State after setup:
 *   - parent `main` has 4 commits:
 *       1. chore: initial scaffold
 *       2. feat: app shell
 *       3. chore: add vendor/lib submodule
 *       4. feat: integrate vendor/lib into entry point
 *   - submodule mounted at `vendor/lib`, tracking branch `main`,
 *     with 4 commits of its own:
 *       1. chore: initial scaffold
 *       2. feat: add core types
 *       3. feat: add main API
 *       4. test: add coverage
 *   - parent pin matches the submodule's HEAD (clean — flag = ` `)
 *   - both worktrees are clean
 *   - no remote configured on either side
 *
 * Designed for nested submodule navigation: the user should be able to
 * `Enter` on the `vendor/lib` row from the parent's status / submodule
 * view, drill into the submodule's history, navigate its 4 commits as
 * if they had `cd vendor/lib && coco ui`, and `Esc` back out to the
 * parent.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 *
 * IMPLEMENTATION NOTE: migrated to the atom layer — `addSubmodule`
 * encapsulates the source-repo build + clone-via-submodule-add
 * dance, and the source's commit history is itself a `chain(...)` of
 * atoms (same composition model parent-side).
 */

import {
  addCommit,
  addSubmodule,
  chain,
  defineScenario,
  seededFiles,
} from '../atoms'

const PARENT_SEED = 0x5ba_a1c0
const SUBMODULE_SEED = 0x5bc0_de00

export const submoduleWithHistoryScenario = defineScenario({
  name: 'submodule-with-history',
  summary: 'parent with 4 commits + vendor/lib submodule pinned at its 4-commit HEAD',
  description: [
    'A parent repo on `main` with 4 commits, including the addition of a',
    'submodule mounted at `vendor/lib`. The submodule itself has 4 commits',
    'of its own, tracks branch `main`, and is currently clean (the parent',
    'pin matches the submodule\'s HEAD).',
    '',
    'Useful for testing:',
    '  - submodule metadata loaders (`.gitmodules` + `git submodule status`)',
    '  - the submodule inspector side-panel (name / pinned / tracking)',
    '  - recursive submodule navigation: `Enter` on the submodule row',
    '    should drill into the submodule\'s history view, where the user',
    '    can navigate its 4 commits as if `coco ui` were launched from',
    '    `vendor/lib`. `Esc` / `<` pops back to the parent.',
    '',
    'No remote is configured on either side. The URL recorded in',
    '`.gitmodules` points at the temp dir the submodule was cloned from',
    '(now removed) — read-only operations work fine offline, but do not',
    'run `git submodule update --remote` or `git submodule sync`.',
  ].join('\n'),
  kind: 'submodule',
  contracts: [
    'parent main has 4 commits',
    'main is checked out',
    '.gitmodules registers vendor/lib with branch = main',
    'vendor/lib is a clean submodule (pin matches HEAD)',
    'vendor/lib has 4 commits of its own',
    'parent worktree is clean',
  ],
  setup: chain(
    // === Parent main: 2-commit baseline before the submodule lands ===
    addCommit({
      message: 'chore: initial scaffold',
      files: {
        'README.md': [
          '# Parent',
          '',
          'A hypothetical parent project that vendors `vendor/lib` as a git',
          'submodule.',
          '',
        ].join('\n'),
        'package.json':
          JSON.stringify(
            { name: 'parent', version: '0.1.0', main: 'src/index.ts' },
            null,
            2,
          ) + '\n',
      },
    }),
    seededFiles({
      files: [
        { path: 'src/index.ts', tokens: 60 },
        { path: 'src/app.ts', tokens: 100 },
      ],
      seed: PARENT_SEED,
    }),
    addCommit({ message: 'feat: app shell' }),

    // === Add the submodule. The source repo is composed from atoms
    //     too — same mental model as the parent. ===
    addSubmodule({
      path: 'vendor/lib',
      branch: 'main',
      setup: chain(
        addCommit({
          message: 'chore: initial scaffold',
          files: {
            'README.md': '# vendor-lib\n\nA hypothetical vendor library used by the parent repo.\n',
          },
        }),
        seededFiles({
          files: [{ path: 'src/types.ts', tokens: 80 }],
          seed: SUBMODULE_SEED + 1,
        }),
        addCommit({ message: 'feat: add core types' }),
        seededFiles({
          files: [{ path: 'src/index.ts', tokens: 140 }],
          seed: SUBMODULE_SEED + 2,
        }),
        addCommit({ message: 'feat: add main API' }),
        seededFiles({
          files: [{ path: 'tests/lib.test.ts', tokens: 110 }],
          seed: SUBMODULE_SEED + 3,
        }),
        addCommit({ message: 'test: add coverage' }),
      ),
    }),
    addCommit({ message: 'chore: add vendor/lib submodule' }),

    // === A post-submodule follow-up so `submodule add` isn't HEAD ===
    seededFiles({
      files: [{ path: 'src/integration.ts', tokens: 90 }],
      seed: PARENT_SEED + 1,
    }),
    addCommit({ message: 'feat: integrate vendor/lib into entry point' }),
  ),
})
