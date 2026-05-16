/**
 * `submodule-with-history` — a parent repo that registers a single
 * submodule (`vendor/lib`), where both sides have real commit history.
 *
 * State after setup:
 *   - parent `main` has 4 commits:
 *       1. chore: initial scaffold
 *       2. feat: app shell
 *       3. chore: add vendor/lib submodule
 *       4. feat: integrate vendor/lib into entry point
 *   - submodule mounted at `vendor/lib`, tracking branch `main`,
 *     with 4 commits of its own:
 *       1. chore: initial scaffold
 *       2. feat: add core types
 *       3. feat: add main API
 *       4. test: add coverage
 *   - parent pin matches the submodule's HEAD (clean — flag = ` `)
 *   - both worktrees are clean
 *   - no remote configured on either side
 *
 * Designed for #931 (recursive submodule navigation): the user should
 * be able to `Enter` on the `vendor/lib` row from the parent's status /
 * submodule view, drill into the submodule's history, navigate its 4
 * commits as if they had `cd vendor/lib && coco ui`, and `Esc` back out
 * to the parent.
 *
 * The submodule source is built in an out-of-tree temp dir, cloned into
 * the parent via `git submodule add`, then the source dir is removed.
 * After setup the cloned submodule is fully self-contained — the URL
 * recorded in `.gitmodules` points at the (now-gone) source path, but
 * read-only operations on `vendor/lib` work fine offline. Do not run
 * `git submodule update --remote` or `git submodule sync` against a
 * materialized scenario; both rely on the URL being live.
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports. The submodule
 * builder reaches into the same Node stdlib (`fs/promises`, `os`,
 * `path`) and `simple-git` the base `tempGitRepo` helper does.
 */

import { execFile } from 'child_process'
import { mkdir, mkdtemp, rm, writeFile as writeFileContent } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { promisify } from 'util'

import type { Scenario } from './types'
import { seededContent, writeSeededFiles } from './shared/seededFiles'

const execFileAsync = promisify(execFile)

const PARENT_SEED = 0x5ba_a1c0
const SUBMODULE_SEED = 0x5bc0_de00

type SubmoduleCommit = {
  path: string
  tokens: number
  message: string
}

const SUBMODULE_COMMITS: SubmoduleCommit[] = [
  // Commit 1 — initial scaffold (README only, no seed)
  { path: 'README.md', tokens: 0, message: 'chore: initial scaffold' },
  // Commit 2 — core types
  { path: 'src/types.ts', tokens: 80, message: 'feat: add core types' },
  // Commit 3 — main API
  { path: 'src/index.ts', tokens: 140, message: 'feat: add main API' },
  // Commit 4 — coverage
  { path: 'tests/lib.test.ts', tokens: 110, message: 'test: add coverage' },
]

/**
 * Build a self-contained git repo on disk (outside the parent's
 * worktree) that will serve as the clone source for `git submodule
 * add`. Returns the absolute path. The caller is responsible for
 * removing the directory once `submodule add` has copied the history
 * out — keeping it around would only leak the same objects already
 * stored under `.git/modules/<name>` inside the parent.
 */
async function buildSubmoduleSource(): Promise<string> {
  const sourcePath = await mkdtemp(join(tmpdir(), 'coco-submodule-source-'))
  const git: SimpleGit = simpleGit(sourcePath)

  await git.init()
  await git.addConfig('user.name', 'Coco Test')
  await git.addConfig('user.email', 'coco@example.com')
  await git.addConfig('commit.gpgsign', 'false')
  await git.raw(['checkout', '-b', 'main'])

  for (let i = 0; i < SUBMODULE_COMMITS.length; i += 1) {
    const commit = SUBMODULE_COMMITS[i]
    const absolute = join(sourcePath, commit.path)
    await mkdir(dirname(absolute), { recursive: true })
    const content = commit.tokens === 0
      ? '# vendor-lib\n\nA hypothetical vendor library used by the parent repo.\n'
      : seededContent(commit.path, commit.tokens, SUBMODULE_SEED + i)
    await writeFileContent(absolute, content)
    await git.add('.')
    await git.commit(commit.message)
  }

  return sourcePath
}

export const submoduleWithHistoryScenario: Scenario = {
  name: 'submodule-with-history',
  summary: 'parent with 4 commits + vendor/lib submodule pinned at its 4-commit HEAD',
  description: [
    'A parent repo on `main` with 4 commits, including the addition of a',
    'submodule mounted at `vendor/lib`. The submodule itself has 4 commits',
    'of its own, tracks branch `main`, and is currently clean (the parent',
    'pin matches the submodule\'s HEAD).',
    '',
    'Useful for testing:',
    '  - submodule metadata loaders (`.gitmodules` + `git submodule status`)',
    '  - the submodule inspector side-panel (name / pinned / tracking)',
    '  - recursive submodule navigation (#931): `Enter` on the submodule',
    '    row should drill into the submodule\'s history view, where the',
    '    user can navigate its 4 commits as if `coco ui` were launched',
    '    from `vendor/lib`. `Esc` / `<` pops back to the parent.',
    '',
    'No remote is configured on either side. The URL recorded in',
    '`.gitmodules` points at the temp dir the submodule was cloned from',
    '(now removed) — read-only operations work fine offline, but do not',
    'run `git submodule update --remote` or `git submodule sync`.',
  ].join('\n'),
  kind: 'submodule',
  contracts: [
    'parent main has 4 commits',
    'main is checked out',
    '.gitmodules registers vendor/lib with branch = main',
    'vendor/lib is a clean submodule (pin matches HEAD)',
    'vendor/lib has 4 commits of its own',
    'parent worktree is clean',
  ],
  setup: async (repo) => {
    // === Parent main: 2-commit baseline before the submodule lands ===
    await repo.writeFile('README.md', [
      '# Parent',
      '',
      'A hypothetical parent project that vendors `vendor/lib` as a git',
      'submodule.',
      '',
    ].join('\n'))
    await repo.writeFile(
      'package.json',
      JSON.stringify({ name: 'parent', version: '0.1.0', main: 'src/index.ts' }, null, 2) + '\n',
    )
    await repo.commitAll('chore: initial scaffold')

    await writeSeededFiles(
      repo,
      [
        { path: 'src/index.ts', tokens: 60 },
        { path: 'src/app.ts', tokens: 100 },
      ],
      PARENT_SEED,
    )
    await repo.commitAll('feat: app shell')

    // === Build the submodule source out-of-tree, then add as submodule ===
    const sourcePath = await buildSubmoduleSource()
    try {
      // `-b main` records `branch = main` in `.gitmodules`, which the
      // submodule overview loader (`src/git/submoduleData.ts`) surfaces
      // as `trackingBranch`.
      //
      // `protocol.file.allow=always` is required on git ≥ 2.38 — without
      // it, file-protocol submodule URLs are refused (CVE-2022-39253).
      // We shell out directly here because simple-git's unsafe-ops
      // plugin blocks the `-c protocol.allow=...` override.
      await execFileAsync(
        'git',
        [
          '-c',
          'protocol.file.allow=always',
          'submodule',
          'add',
          '-b',
          'main',
          sourcePath,
          'vendor/lib',
        ],
        { cwd: repo.path },
      )
      await repo.commitAll('chore: add vendor/lib submodule')
    } finally {
      await rm(sourcePath, { recursive: true, force: true })
    }

    // === A post-submodule follow-up so `submodule add` isn't HEAD ===
    await writeSeededFiles(
      repo,
      [{ path: 'src/integration.ts', tokens: 90 }],
      PARENT_SEED + 1,
    )
    await repo.commitAll('feat: integrate vendor/lib into entry point')
  },
}
