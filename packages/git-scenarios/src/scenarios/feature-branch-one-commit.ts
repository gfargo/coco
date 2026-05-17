/**
 * `feature-branch-one-commit` — a minimal feature-branch shape. `main`
 * has the initial scaffold; `feat/x` is checked out with exactly one
 * commit on top. The shape every "compare current branch against main"
 * test wants — changelog, review, branch diff.
 *
 * State after setup:
 *   - `main` has 1 commit (initial scaffold with README.md)
 *   - `feat/x` is checked out, 1 commit ahead of main, adds `src/feature.ts`
 *   - worktree is clean
 *
 * Used by `coco changelog --branch main`, `coco review --branch main`,
 * and any other flow that compares the working branch against a base.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import { addCommit, chain, defineScenario, switchToBranch } from '../atoms'

export const featureBranchOneCommitScenario = defineScenario({
  name: 'feature-branch-one-commit',
  summary: 'main + feat/x (1 commit ahead, src/feature.ts)',
  description: [
    'Minimal feature-branch shape. `main` has one initial commit;',
    '`feat/x` is checked out with one commit on top adding',
    '`src/feature.ts`. The worktree is clean.',
    '',
    'Useful for testing:',
    '  - `coco changelog --branch main`',
    '  - `coco review --branch main`',
    '  - any branch-vs-base diff flow',
    '  - the changelog auto-body in the create-PR flow',
  ].join('\n'),
  kind: 'branch',
  contracts: [
    'main has 1 commit',
    'feat/x is checked out',
    'feat/x has 1 commit on top of main',
    'src/feature.ts exists',
    'worktree is clean',
  ],
  setup: chain(
    addCommit({ message: 'chore: initial commit', files: { 'README.md': '# Temp repo\n' } }),
    switchToBranch('feat/x'),
    addCommit({
      message: 'feat: add feature module',
      files: { 'src/feature.ts': 'export const feature = true\n' },
    }),
  ),
})
