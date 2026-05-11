/**
 * `stashed-changes` — a clean worktree on `main` with 3 stash entries,
 * each carrying a distinct user-supplied message. Designed for testing
 * the stash view's list rendering, per-entry actions (apply / pop /
 * drop / checkout-file-from-stash), and the diff view's stash mode.
 *
 * State after setup:
 *   - `main` has 2 commits (initial + a small content baseline)
 *   - worktree is clean
 *   - `git stash list` shows 3 stashes with messages:
 *       stash@{0} — "WIP: experiment-c"
 *       stash@{1} — "WIP: experiment-b"
 *       stash@{2} — "WIP: experiment-a"
 *
 * Each stash carries edits to a different file so applying any one is
 * idempotent against the baseline + non-conflicting with the others
 * (useful for chained apply tests).
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import type { Scenario } from './types'

export const stashedChangesScenario: Scenario = {
  name: 'stashed-changes',
  summary: 'clean worktree on main + 3 stashes, each touching a different file',
  description: [
    'A repository with 3 distinct stashes preserved on top of a small',
    '2-commit `main`. The worktree is clean; the stashes live only in',
    '`refs/stash` and the reflog. Each stash carries edits to a',
    'different file so applying any one is non-conflicting with the',
    'others.',
    '',
    'Useful for testing:',
    '  - stash view list rendering + filter',
    '  - per-entry actions: apply, pop, drop, checkout-file-from-stash',
    '  - diff view in stash mode (file-by-file navigation inside a patch)',
    '  - sidebar stashes-tab rendering',
  ].join('\n'),
  kind: 'stash',
  contracts: [
    'main has 2 commits',
    'worktree is clean',
    'git stash list reports 3 entries',
    'each stash touches a different file',
  ],
  setup: async (repo) => {
    // === baseline ===
    await repo.writeFile('README.md', '# Stash playground\n')
    await repo.commitAll('chore: initial scaffold')

    // Baseline files that each stash will edit a copy of.
    await repo.writeFile('src/feature-a.ts', 'export const a = "baseline"\n')
    await repo.writeFile('src/feature-b.ts', 'export const b = "baseline"\n')
    await repo.writeFile('src/feature-c.ts', 'export const c = "baseline"\n')
    await repo.commitAll('chore: baseline content for stashing')

    // === stash 1 — edit feature-a, stash with message ===
    await repo.writeFile('src/feature-a.ts', 'export const a = "experiment-a"\n')
    await repo.git.raw(['stash', 'push', '-u', '-m', 'WIP: experiment-a'])

    // === stash 2 — edit feature-b ===
    await repo.writeFile('src/feature-b.ts', 'export const b = "experiment-b"\n')
    await repo.git.raw(['stash', 'push', '-u', '-m', 'WIP: experiment-b'])

    // === stash 3 — edit feature-c ===
    await repo.writeFile('src/feature-c.ts', 'export const c = "experiment-c"\n')
    await repo.git.raw(['stash', 'push', '-u', '-m', 'WIP: experiment-c'])

    // Worktree is now clean — every stash carried away its own edits.
  },
}
