/**
 * `dirty-many-files` — a worktree with a large dirty set spanning
 * multiple top-level directories. Designed for testing commit-split
 * flows, status-surface paging, and compose-view affordances that
 * should surface when a user is about to commit a sprawling change.
 *
 * State after setup:
 *   - `main` has 2 baseline commits
 *   - worktree has 12 staged + 6 unstaged + 3 untracked files
 *   - the dirty set spans 3 distinct top-level dirs (`src/`, `tests/`,
 *     `docs/`) plus root-level config files
 *
 * Used to validate the split-in-compose flow and any future
 * worktree-paging UI.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import {
  addCommit,
  chain,
  defineScenario,
  seededFiles,
  stageFiles,
  writeFiles,
} from '../atoms'

const SEED = 0xd1f71e5

const STAGED_PATHS = [
  'src/widgets/index.ts',
  'src/widgets/button.ts',
  'src/widgets/input.ts',
  'src/widgets/modal.ts',
  'src/widgets/types.ts',
  'src/widgets/styles.ts',
  'tests/widgets/button.test.ts',
  'tests/widgets/input.test.ts',
  'tests/widgets/modal.test.ts',
  'docs/widgets-guide.md',
  'src/index.ts',
  '.widgetsrc.json',
] as const

export const dirtyManyFilesScenario = defineScenario({
  name: 'dirty-many-files',
  summary: '12 staged + 6 unstaged + 3 untracked across 3 top-level dirs',
  description: [
    'A worktree mid-development with a large dirty set. `main` has 2',
    'baseline commits; the working tree adds 12 staged files, modifies',
    '6 unstaged files, and includes 3 untracked files. Changes span',
    'three top-level directories (`src/`, `tests/`, `docs/`) plus',
    'root-level config — exactly the shape that benefits from',
    '`coco commit --split`.',
    '',
    'Useful for testing:',
    '  - the split-in-compose flow once it ships',
    '  - status-surface paging behavior with many files',
    '  - the "large changeset" heuristic in compose',
    '  - filter / mask narrowing on the status view',
  ].join('\n'),
  kind: 'worktree',
  contracts: [
    'main has 2 commits',
    'worktree has 12 staged files',
    'worktree has 6 unstaged files',
    'worktree has 3 untracked files',
    'changes span src/, tests/, and docs/',
  ],
  setup: chain(
    // === baseline scaffold ===
    addCommit({
      message: 'chore: initial commit',
      files: {
        'README.md': '# Sprawl\n\nA project mid-refactor.\n',
        'package.json':
          JSON.stringify({ name: 'sprawl', version: '0.2.0', main: 'src/index.ts' }, null, 2) + '\n',
      },
    }),

    // Baseline files that will be modified later.
    seededFiles({
      files: [
        { path: 'src/index.ts', tokens: 80 },
        { path: 'src/router.ts', tokens: 120 },
        { path: 'src/store.ts', tokens: 140 },
        { path: 'src/utils.ts', tokens: 70 },
        { path: 'src/types.ts', tokens: 60 },
        { path: 'src/api.ts', tokens: 100 },
        { path: 'tests/router.test.ts', tokens: 90 },
        { path: 'tests/store.test.ts', tokens: 110 },
        { path: 'docs/architecture.md', tokens: 200 },
        { path: 'docs/contributing.md', tokens: 80 },
      ],
      seed: SEED,
    }),
    addCommit({ message: 'chore: baseline app scaffold' }),

    // === 12 staged: new feature module + tests + docs ===
    seededFiles({
      files: [
        // Feature: new `widgets` module across 6 files
        { path: 'src/widgets/index.ts', tokens: 50 },
        { path: 'src/widgets/button.ts', tokens: 130 },
        { path: 'src/widgets/input.ts', tokens: 140 },
        { path: 'src/widgets/modal.ts', tokens: 180 },
        { path: 'src/widgets/types.ts', tokens: 70 },
        { path: 'src/widgets/styles.ts', tokens: 90 },
        // Tests for the new module
        { path: 'tests/widgets/button.test.ts', tokens: 100 },
        { path: 'tests/widgets/input.test.ts', tokens: 110 },
        { path: 'tests/widgets/modal.test.ts', tokens: 140 },
        // Docs
        { path: 'docs/widgets-guide.md', tokens: 250 },
        // Top-level integration: re-export from index + a config file
        { path: 'src/index.ts', tokens: 90 }, // re-touch baseline
        { path: '.widgetsrc.json', tokens: 30 },
      ],
      seed: SEED + 1,
    }),
    stageFiles(...STAGED_PATHS),

    // === 6 unstaged: in-progress refactor touching baseline files ===
    // These are MODIFICATIONS to existing files — re-seed so the
    // content differs from the baseline content. No stage call —
    // they stay in the worktree only.
    seededFiles({
      files: [
        { path: 'src/router.ts', tokens: 130 },
        { path: 'src/store.ts', tokens: 150 },
        { path: 'src/utils.ts', tokens: 80 },
        { path: 'src/api.ts', tokens: 110 },
        { path: 'tests/router.test.ts', tokens: 100 },
        { path: 'docs/architecture.md', tokens: 220 },
      ],
      seed: SEED + 2,
    }),

    // === 3 untracked: scratch / experimental files ===
    writeFiles({
      'scratch.md': '# scratchpad\n\n- TODO: pick up where left off\n',
      'src/_experimental.ts': '// experimental — do not ship\n',
      'docs/_draft.md': '# Draft notes\n\nLorem ipsum.\n',
    }),
  ),
})
