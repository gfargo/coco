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
 * Used to validate the bisect view (#784) — empty-state explainer
 * doesn't apply (bisect IS active), but the active-bisect rendering
 * with no decisions logged yet is a distinct state worth covering.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import type { Scenario } from './types'
import { writeSeededFiles } from './shared/seededFiles'

const SEED = 0xb15ec7

export const midBisectScenario: Scenario = {
  name: 'mid-bisect',
  summary: '20-commit history with `git bisect` started, HEAD at midpoint',
  description: [
    'A repository with 20 commits on `main` and an active `git bisect`',
    'run. HEAD is detached at the midpoint candidate; no `good` / `bad`',
    'decisions have been recorded yet. The bisect log carries only the',
    'start markers (`git bisect start <bad> <good>`).',
    '',
    'Useful for testing:',
    '  - bisect view active-state rendering (#784)',
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
  setup: async (repo) => {
    // 20 progressive commits. Each touches one file with seeded content
    // so the bisect candidate diff at each commit is non-trivial but
    // deterministic.
    await repo.writeFile('README.md', '# Bisect target\n')
    await repo.commitAll('chore: initial scaffold')

    // 19 additional commits, each touching its own file. Total: 20.
    for (let i = 1; i <= 19; i += 1) {
      await writeSeededFiles(repo, [
        { path: `src/step-${String(i).padStart(2, '0')}.ts`, tokens: 60 },
      ], SEED + i)
      await repo.commitAll(`feat: step ${i}`)
    }

    // Resolve refs: `bad` = current HEAD, `good` = HEAD~19 (the initial
    // scaffold). Capture the sha of the good ref before running bisect
    // because `HEAD~19` becomes unresolvable mid-bisect when HEAD is
    // detached. Using shas keeps the scenario reproducible regardless
    // of which midpoint git picks.
    const badSha = (await repo.git.revparse(['HEAD'])).trim()
    const goodSha = (await repo.git.revparse(['HEAD~19'])).trim()

    // Start the bisect. Git checks out the midpoint commit automatically.
    await repo.git.raw(['bisect', 'start', badSha, goodSha])
  },
}
