/**
 * `two-commit-feature` — a tiny repo with two commits: a baseline
 * scaffold and a follow-up "feat: add feature module." Clean worktree.
 * The smallest shape that has a non-trivial commit history to inspect.
 *
 * State after setup:
 *   - `main` has 2 commits (chore + feat)
 *   - `README.md` and `src/feature.ts` exist on disk
 *   - worktree is clean (no staged / unstaged / untracked files)
 *
 * Heavily used by integration tests for `coco changelog`, `coco log`,
 * and `coco review` — anywhere a test needs "a repo with at least one
 * non-initial commit and a feature file to read."
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import { addCommit, chain, defineScenario } from '../atoms'

export const twoCommitFeatureScenario = defineScenario({
  name: 'two-commit-feature',
  summary: 'baseline scaffold + a single feat commit, clean worktree',
  description: [
    'Two commits on `main`: a baseline scaffold and one feat commit',
    'adding `src/feature.ts`. The worktree is clean.',
    '',
    'Useful for testing:',
    '  - `coco changelog` (has one non-baseline commit to summarize)',
    '  - `coco log` table / JSON output (one feature commit to inspect)',
    '  - `coco review` against a feature branch',
    '  - smoke tests that need a `feat:` commit subject to render',
  ].join('\n'),
  kind: 'branch',
  contracts: [
    'main has 2 commits',
    'commit subjects are "chore: initial commit" and "feat: add feature module"',
    'src/feature.ts exists',
    'worktree is clean',
  ],
  setup: chain(
    addCommit({ message: 'chore: initial commit', files: { 'README.md': '# Temp repo\n' } }),
    addCommit({
      message: 'feat: add feature module',
      files: { 'src/feature.ts': 'export const feature = true\n' },
    }),
  ),
})
