/**
 * `mid-merge-conflict` — a repo mid-merge with one unresolved conflict.
 * Two branches edit the same line of the same file; merging `feat/x`
 * into `main` leaves the worktree with conflict markers and the merge
 * uncommitted.
 *
 * State after setup:
 *   - `main` has 3 commits — initial scaffold, baseline content, and a
 *     conflicting edit to `src/widget.ts`
 *   - `feat/x` has 2 commits forked from the baseline — a separate
 *     conflicting edit to `src/widget.ts`
 *   - `main` is checked out, `git merge feat/x` was attempted
 *   - `src/widget.ts` has unresolved conflict markers (<<<<<<< / =======
 *     / >>>>>>>) and is unstaged
 *   - `MERGE_HEAD` is set; `git status` reports the merge as in
 *     progress
 *
 * Used to validate the conflicts view (and any flow that needs to
 * observe a real in-progress operation).
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 *
 * IMPLEMENTATION NOTE: migrated to the atom layer — uses `startMerge`
 * to attempt the merge and leave it in conflict (default
 * `allowConflict: true`).
 */

import {
  addCommit,
  chain,
  checkoutBranch,
  defineScenario,
  startMerge,
  switchToBranch,
} from '../atoms'

const widgetSource = (name: string): string =>
  [`export const widget = {`, `  name: "${name}",`, `  version: 1,`, `}`, ``].join('\n')

export const midMergeConflictScenario = defineScenario({
  name: 'mid-merge-conflict',
  summary: 'in-progress merge with one unresolved conflict in src/widget.ts',
  description: [
    'A repository mid-merge, blocked on one unresolved conflict.',
    '`main` and `feat/x` both edited the same line of `src/widget.ts`',
    'after forking from a shared baseline. Running `git merge feat/x`',
    'on `main` triggered the conflict; the merge is now sitting',
    'uncommitted with conflict markers in the worktree.',
    '',
    'Useful for testing:',
    '  - conflicts view rendering + per-file resolve actions',
    '  - title-bar in-progress-operation indicator',
    '  - the `coco doctor` / `coco ui` flows when a merge is in flight',
    '  - the C / Esc guard on the conflicts view',
  ].join('\n'),
  kind: 'operation',
  contracts: [
    'main is checked out',
    'a merge is in progress (MERGE_HEAD exists)',
    'src/widget.ts has unresolved conflict markers',
    'exactly 1 unresolved conflict',
  ],
  setup: chain(
    // === baseline shared by both branches ===
    addCommit({ message: 'chore: initial scaffold', files: { 'README.md': '# Widget\n' } }),
    addCommit({ message: 'feat: baseline widget', files: { 'src/widget.ts': widgetSource('baseline') } }),

    // === feat/x — its own rename of the widget ===
    switchToBranch('feat/x'),
    addCommit({
      message: 'feat: rename widget on feat/x',
      files: { 'src/widget.ts': widgetSource('from-feat-x') },
    }),

    // === main — conflicting rename of the same line ===
    checkoutBranch('main'),
    addCommit({
      message: 'feat: rename widget on main',
      files: { 'src/widget.ts': widgetSource('from-main') },
    }),

    // === merge attempt — leaves conflict markers in the worktree ===
    startMerge('feat/x'),
  ),
})
