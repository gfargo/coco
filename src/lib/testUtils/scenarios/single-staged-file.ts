/**
 * `single-staged-file` — minimal "ready to commit" state. A repo with
 * one baseline commit and a single staged README. The smallest possible
 * shape that lets `coco commit` actually have something to generate a
 * message for.
 *
 * State after setup:
 *   - `main` has 1 commit (initial scaffold)
 *   - `README.md` is staged with new content
 *   - no other staged / unstaged / untracked files
 *
 * Heavily used by integration tests for the `coco commit` family
 * (commit, summarize, model routing) where the actual diff payload
 * is incidental — the tests just need *some* staged diff to feed
 * the pipeline.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports.
 */

import type { Scenario } from './types'

export const singleStagedFileScenario: Scenario = {
  name: 'single-staged-file',
  summary: 'one baseline commit + a single staged README',
  description: [
    'Minimal "ready to commit" state. A single baseline commit on',
    '`main` plus one staged file (`README.md`). No unstaged or',
    'untracked files.',
    '',
    'Useful for testing:',
    '  - `coco commit` (any flavor — has a staged diff to summarize)',
    '  - any flow that asserts "there is staged content to commit"',
    '  - smoke tests that just need a valid commit-ready repo',
  ].join('\n'),
  kind: 'worktree',
  contracts: [
    'main has 1 commit',
    'exactly 1 staged file (README.md)',
    'no unstaged or untracked files',
  ],
  setup: async (repo) => {
    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.git.add('README.md')
  },
}
