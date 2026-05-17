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

import type { Scenario } from './types'

export const featureBranchOneCommitScenario: Scenario = {
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
    '  - the changelog auto-body in the create-PR flow (#905)',
  ].join('\n'),
  kind: 'branch',
  contracts: [
    'main has 1 commit',
    'feat/x is checked out',
    'feat/x has 1 commit on top of main',
    'src/feature.ts exists',
    'worktree is clean',
  ],
  setup: async (repo) => {
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')

    await repo.git.checkoutLocalBranch('feat/x')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.commitAll('feat: add feature module')
  },
}
