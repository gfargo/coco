/**
 * `stashed-changes` — a clean worktree on `main` with 3 stash entries,
 * each carrying a distinct user-supplied message. Designed for testing
 * stash view list rendering, per-entry actions (apply / pop / drop /
 * checkout-file-from-stash), and the diff view's stash mode.
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
 *
 * IMPLEMENTATION NOTE: migrated to the atom layer — uses
 * `stashChanges` to push each stash entry without inlining
 * `git stash push -u -m ...`.
 */

import {
  addCommit,
  chain,
  defineScenario,
  stashChanges,
  writeFiles,
} from '../atoms'

export const stashedChangesScenario = defineScenario({
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
  setup: chain(
    // === baseline ===
    addCommit({ message: 'chore: initial scaffold', files: { 'README.md': '# Stash playground\n' } }),
    addCommit({
      message: 'chore: baseline content for stashing',
      files: {
        'src/feature-a.ts': 'export const a = "baseline"\n',
        'src/feature-b.ts': 'export const b = "baseline"\n',
        'src/feature-c.ts': 'export const c = "baseline"\n',
      },
    }),

    // === stash 1 — edit feature-a ===
    writeFiles({ 'src/feature-a.ts': 'export const a = "experiment-a"\n' }),
    stashChanges({ message: 'WIP: experiment-a', includeUntracked: true }),

    // === stash 2 — edit feature-b ===
    writeFiles({ 'src/feature-b.ts': 'export const b = "experiment-b"\n' }),
    stashChanges({ message: 'WIP: experiment-b', includeUntracked: true }),

    // === stash 3 — edit feature-c ===
    writeFiles({ 'src/feature-c.ts': 'export const c = "experiment-c"\n' }),
    stashChanges({ message: 'WIP: experiment-c', includeUntracked: true }),
  ),
})
