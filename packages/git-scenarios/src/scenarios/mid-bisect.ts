/**
 * `mid-bisect` — a repo with 20 commits and an in-progress `git bisect`
 * already running. The bisect has been started with `good=HEAD~19`
 * and `bad=HEAD`, but no decisions have been logged yet — HEAD sits at
 * git's chosen midpoint candidate, waiting for the user to mark it.
 *
 * State after setup:
 *   - `main` has 20 commits (1 scaffold + 19 progressive)
 *   - `git bisect start <bad> <good>` has been invoked
 *   - HEAD is detached at the midpoint
 *   - `.git/BISECT_LOG` exists with the start markers but no decisions
 *
 * Used to validate the bisect view — empty-state explainer doesn't
 * apply (bisect IS active), but the active-bisect rendering with no
 * decisions logged yet is a distinct state worth covering.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import {
  addCommit,
  chain,
  defineScenario,
  repeat,
  seededFiles,
  startBisect,
  type Step,
} from '../atoms'

const SEED = 0xb15ec7

/**
 * Capture the current HEAD as `bad` and HEAD~19 as `good`, then start
 * the bisect. Inlined here because `startBisect` takes literal refs;
 * the resolution against HEAD has to happen at run time after the
 * commits exist. A future atom (e.g. `bisectFromRange({ goodBack: 19 })`)
 * could absorb this if the pattern recurs.
 */
const startBisectFromCurrentHistory: Step = async (repo) => {
  const bad = (await repo.git.revparse(['HEAD'])).trim()
  const good = (await repo.git.revparse(['HEAD~19'])).trim()
  await startBisect({ bad, good })(repo)
}

export const midBisectScenario = defineScenario({
  name: 'mid-bisect',
  summary: '20-commit history with `git bisect` started, HEAD at midpoint',
  description: [
    'A repository with 20 commits on `main` and an active `git bisect`',
    'run. HEAD is detached at the midpoint candidate; no `good` / `bad`',
    'decisions have been recorded yet. The bisect log carries only the',
    'start markers (`git bisect start <bad> <good>`).',
    '',
    'Useful for testing:',
    '  - bisect view active-state rendering',
    '  - decision keystrokes (`g`/`b`/`s`/`x`) and their immediate effect',
    '  - completion-panel detection (apply `g` / `b` repeatedly until',
    '    git emits "X is the first bad commit")',
    '  - title-bar BISECTING badge',
  ].join('\n'),
  kind: 'operation',
  contracts: [
    'main has 20 commits',
    'a bisect is in progress',
    'HEAD is detached',
    'no bisect decisions logged yet',
  ],
  setup: chain(
    addCommit({ message: 'chore: initial scaffold', files: { 'README.md': '# Bisect target\n' } }),
    // 19 additional commits, each touching its own file. Total: 20.
    repeat(19, (i) =>
      chain(
        seededFiles({
          files: [{ path: `src/step-${String(i + 1).padStart(2, '0')}.ts`, tokens: 60 }],
          seed: SEED + i + 1,
        }),
        addCommit({ message: `feat: step ${i + 1}` }),
      ),
    ),
    startBisectFromCurrentHistory,
  ),
})
