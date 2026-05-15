/**
 * `rich-history-graph` — a multi-branch repo whose log spans every
 * date bucket, every conventional-commit type, and several lane-
 * merging topologies. Built to give the history surface
 * (compact + full graph) something rich to render: section headers,
 * type-colored prefixes, branch chips, lane-color transitions, and
 * a still-active unmerged branch.
 *
 * State after setup (relative to "today" at run time):
 *   - main is checked out, clean worktree
 *   - 4 merge commits on main + linear stretches between them
 *   - `feat/wip` exists and is NOT merged into main (chip target)
 *   - Commit dates span: 60 days ago → today, hitting every bucket
 *     (today, yesterday, this-week, last-week, two earlier
 *     calendar months)
 *
 * Used to validate the rendering of:
 *   - date bucket dividers (`── Today ──`, `── April 2026 ──`, …)
 *   - conventional-commit type coloring (feat / fix / chore / docs /
 *     refactor / test / perf / revert / `fix!:` breaking marker)
 *   - branch-tip chips (HEAD branch + unmerged `feat/wip`)
 *   - lane coloring across forks (`├╮`) and merges (`├╯`)
 *   - sticky bucket header on deep scroll
 *
 * Manual driver:
 *   npm run scenario create rich-history-graph -- --run-ui
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports. Date overrides
 * are plumbed through `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` so
 * the scenario stays as a pure git-state factory.
 */

import type { TempGitRepo } from '../tempGitRepo'
import type { Scenario } from './types'
import { writeSeededFiles } from './shared/seededFiles'

const BASE_SEED = 0xc0c0a11e

/**
 * UTC midnight `daysAgo` days before now, returned as an ISO string
 * git accepts via `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`. Pinned at
 * 12:00 UTC so the date portion never drifts across timezones — the
 * bucket helper compares at day granularity, so the time of day is
 * irrelevant beyond making the date stable.
 */
function isoDaysAgo(daysAgo: number): string {
  const now = new Date()
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysAgo,
    12, 0, 0,
  ))
  return d.toISOString()
}

/**
 * Stage everything and commit with both AUTHOR and COMMITTER dates
 * pinned to `daysAgo`. Uses raw git so we don't depend on simple-git's
 * `commit()` signature for the date override — that helper only sets
 * the author date, but `git log --date=short` (and downstream
 * bucketing) reads the date that's exposed in the formatted output,
 * which lines up cleanly when both env vars match.
 */
async function commitAtDay(
  repo: TempGitRepo,
  daysAgo: number,
  message: string,
): Promise<void> {
  const iso = isoDaysAgo(daysAgo)
  await repo.git.add('.')
  await repo.git
    .env({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
    .raw(['commit', '-m', message])
}

/**
 * Write a small per-commit file then call `commitAtDay`. Picking a
 * fresh file path per commit guarantees git treats every step as a
 * non-empty change without us having to track the running scenario
 * state.
 */
async function writeAndCommitAtDay(
  repo: TempGitRepo,
  daysAgo: number,
  filePath: string,
  message: string,
  seedOffset: number,
): Promise<void> {
  await writeSeededFiles(repo, [{ path: filePath, tokens: 60 + seedOffset }], BASE_SEED + seedOffset)
  await commitAtDay(repo, daysAgo, message)
}

/**
 * Always-`--no-ff` merge of `branch` into the current branch at
 * `daysAgo` with author + committer dates pinned. Forces a merge
 * commit even when the branch could fast-forward so the graph shows
 * a real lane closure (`├╯`) instead of a silent linear advance.
 */
async function mergeAtDay(
  repo: TempGitRepo,
  daysAgo: number,
  branch: string,
  message: string,
): Promise<void> {
  const iso = isoDaysAgo(daysAgo)
  await repo.git
    .env({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
    .raw(['merge', '--no-ff', branch, '-m', message])
}

export const richHistoryGraphScenario: Scenario = {
  name: 'rich-history-graph',
  summary:
    'multi-branch history that exercises bucket dividers, type coloring, branch chips, lane topology',
  description: [
    'A multi-branch repo built to stress the history surface. Commits',
    'span every date bucket (today / yesterday / this-week / last-week',
    'plus two older calendar-month buckets), every conventional-commit',
    'type the renderer knows (feat / fix / chore / docs / refactor /',
    'test / perf / revert plus a `fix!:` breaking marker), and three',
    'distinct branch lifecycles: two feature branches merged back into',
    'main with --no-ff merge commits, plus one unmerged `feat/wip`',
    'sitting as a live branch tip.',
    '',
    'Run with --run-ui to drive the workstation against it:',
    '',
    '  npm run scenario create rich-history-graph -- --run-ui',
    '',
    'Toggle `g` to flip between compact and full graph modes; the same',
    'underlying history exercises both renderers.',
  ].join('\n'),
  kind: 'history',
  contracts: [
    'main is checked out',
    'feat/wip exists and is NOT merged into main',
    'two --no-ff merge commits sit on main (feat/auth, feat/payments)',
    'worktree is clean',
    'commits span at least 6 distinct date buckets (today through 2 older months)',
    'commit messages cover feat / fix / chore / docs / refactor / test / perf / revert and a breaking-change `!:`',
  ],
  async setup(repo) {
    // ── March bucket (oldest) ────────────────────────────────────
    await writeAndCommitAtDay(repo, 60, 'README.md', 'Initial scaffold', 0)
    await writeAndCommitAtDay(repo, 45, 'src/api/router.ts', 'feat(api): public router skeleton', 1)

    // ── April bucket (older month) ──────────────────────────────
    await writeAndCommitAtDay(repo, 30, 'docs/README-extended.md', 'docs: project README and contributor guide', 2)

    // First feature branch — feat/auth — lives 25-22d ago
    await repo.git.checkoutLocalBranch('feat/auth')
    await writeAndCommitAtDay(repo, 25, 'src/auth/session.ts', 'feat(auth): session middleware', 3)
    await writeAndCommitAtDay(repo, 23, 'tests/auth/session.test.ts', 'test: cover session edge cases', 4)

    // Merge feat/auth back to main
    await repo.git.checkout('main')
    await mergeAtDay(repo, 22, 'feat/auth', "Merge branch 'feat/auth'")

    await writeAndCommitAtDay(repo, 20, 'src/api/errors.ts', 'refactor(api): centralise error shapes', 5)
    await writeAndCommitAtDay(repo, 16, 'src/api/router.ts', 'fix(api): route precedence for catch-all', 6)

    // ── Last-week bucket (7-13d) ─────────────────────────────────
    await writeAndCommitAtDay(repo, 13, 'package.json', 'chore(deps): bump simple-git to 4.x', 7)
    await writeAndCommitAtDay(repo, 12, 'docs/CONTRIBUTING.md', 'docs: contributor guide', 8)

    // Second feature branch — feat/payments — lives 11-7d ago
    await repo.git.checkoutLocalBranch('feat/payments')
    await writeAndCommitAtDay(repo, 11, 'src/payments/checkout.ts', 'feat(payments): stripe checkout adapter', 9)
    await writeAndCommitAtDay(repo, 10, 'src/payments/3ds.ts', 'fix(payments): handle 3D-secure redirect', 10)
    await writeAndCommitAtDay(repo, 9, 'tests/payments/checkout.test.ts', 'test: cover stripe checkout flow', 11)

    await repo.git.checkout('main')
    await mergeAtDay(repo, 7, 'feat/payments', "Merge branch 'feat/payments'")

    // ── This-week bucket (2-6d) ──────────────────────────────────
    await writeAndCommitAtDay(repo, 6, 'src/api/router.ts', 'perf(api): cache compiled route matcher', 12)
    await writeAndCommitAtDay(repo, 5, 'src/db/queries.ts', 'fix(db): retry on transient timeout', 13)
    await writeAndCommitAtDay(repo, 4, 'src/db/migrations/0001_add_index.sql', 'perf(db): index user_id on sessions', 14)

    // Third feature branch — feat/wip — diverged but NOT merged.
    // Leaves a live unmerged tip so the chip renderer has a target.
    await repo.git.checkoutLocalBranch('feat/wip')
    await writeAndCommitAtDay(repo, 3, 'src/search/experimental.ts', 'feat(search): experimental trigram backend', 15)
    await writeAndCommitAtDay(repo, 2, 'src/search/cache.ts', 'chore(search): prototype lookup cache', 16)

    // Back to main for the final stretch + today's commits.
    await repo.git.checkout('main')

    // ── Yesterday bucket ─────────────────────────────────────────
    await writeAndCommitAtDay(repo, 1, 'src/api/router.ts', 'fix!: drop deprecated v1 endpoints', 17)

    // ── Today bucket ─────────────────────────────────────────────
    await writeAndCommitAtDay(repo, 0, 'src/index.ts', 'chore: tidy imports', 18)
    await writeAndCommitAtDay(repo, 0, 'src/api/router.ts', 'revert: temporary rollback of v1-shim removal', 19)
    await writeAndCommitAtDay(repo, 0, 'src/search/index.ts', 'feat(search): trigram-based subject filter', 20)

    // End state: HEAD on main, clean worktree, feat/wip and feat/auth
    // and feat/payments all preserved as branch refs. feat/auth and
    // feat/payments are reachable from main via their merge commits;
    // feat/wip is NOT reachable from main.
  },
}
