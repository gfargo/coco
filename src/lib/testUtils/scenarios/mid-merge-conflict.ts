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
 */

import type { Scenario } from './types'

export const midMergeConflictScenario: Scenario = {
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
    '  - the C / Esc guard on the conflicts view (#905 included this)',
  ].join('\n'),
  kind: 'operation',
  contracts: [
    'main is checked out',
    'a merge is in progress (MERGE_HEAD exists)',
    'src/widget.ts has unresolved conflict markers',
    'exactly 1 unresolved conflict',
  ],
  setup: async (repo) => {
    // === baseline ===
    await repo.writeFile('README.md', '# Widget\n')
    await repo.commitAll('chore: initial scaffold')

    await repo.writeFile('src/widget.ts', [
      'export const widget = {',
      '  name: "baseline",',
      '  version: 1,',
      '}',
      '',
    ].join('\n'))
    await repo.commitAll('feat: baseline widget')

    // === feat/x — different name for the widget ===
    await repo.git.checkoutLocalBranch('feat/x')
    await repo.writeFile('src/widget.ts', [
      'export const widget = {',
      '  name: "from-feat-x",',
      '  version: 1,',
      '}',
      '',
    ].join('\n'))
    await repo.commitAll('feat: rename widget on feat/x')

    // === main — different name for the widget (conflicts with feat/x's edit) ===
    await repo.git.checkout('main')
    await repo.writeFile('src/widget.ts', [
      'export const widget = {',
      '  name: "from-main",',
      '  version: 1,',
      '}',
      '',
    ].join('\n'))
    await repo.commitAll('feat: rename widget on main')

    // === merge attempt — leaves conflict markers in the worktree ===
    // Using `git merge --no-commit --no-ff` here so the merge state is
    // preserved even if the merge could otherwise be fast-forwarded
    // (it can't, but belt-and-suspenders). `--no-commit` ensures we
    // stop with conflict markers in place; in this case the conflict
    // would prevent the auto-commit anyway, but explicit > implicit.
    try {
      await repo.git.raw(['merge', '--no-commit', '--no-ff', 'feat/x'])
    } catch {
      // simple-git throws on non-zero exit (which is what `git merge`
      // does when there are unresolved conflicts). That's exactly the
      // state we want — swallow the error so the scenario completes.
    }
  },
}
