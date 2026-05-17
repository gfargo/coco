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
 *   - 2 merge commits on main + linear stretches between them
 *   - `feat/wip` exists and is NOT merged into main (chip target)
 *   - Commit dates span: 60 days ago → today, hitting every bucket
 *
 * Used to validate the rendering of date buckets, type coloring,
 * branch chips, lane topology, and the sticky bucket header on
 * deep scroll.
 *
 * Manual driver:
 *   npm run scenario create rich-history-graph -- --run-ui
 *
 * Add `--remote <url>` to exercise gh-aware features:
 *   npm run scenario create rich-history-graph -- --run-ui \
 *     --remote git@github.com:org/repo.git
 *
 * EXTRACTION DISCIPLINE: no coco-specific imports. Date overrides
 * are plumbed through `addCommit({ date: daysAgo(n) })` so the
 * scenario stays a pure git-state factory.
 */

import {
  addCommit,
  chain,
  checkoutBranch,
  daysAgo,
  defineScenario,
  seededFiles,
  startMerge,
  switchToBranch,
  type Step,
} from '../atoms'

const BASE_SEED = 0xc0c0a11e

/**
 * Write one small seeded file then commit at the given relative day
 * with the given message. Combined with `addCommit({ date })` so the
 * commit's author + committer dates are pinned.
 */
function writeAndCommitAtDay(
  daysAgoN: number,
  filePath: string,
  message: string,
  seedOffset: number,
): Step {
  return chain(
    seededFiles({
      files: [{ path: filePath, tokens: 60 + seedOffset }],
      seed: BASE_SEED + seedOffset,
    }),
    addCommit({ message, date: daysAgo(daysAgoN) }),
  )
}

export const richHistoryGraphScenario = defineScenario({
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
  setup: chain(
    // ── March bucket (oldest) ────────────────────────────────────
    writeAndCommitAtDay(60, 'README.md', 'Initial scaffold', 0),
    writeAndCommitAtDay(45, 'src/api/router.ts', 'feat(api): public router skeleton', 1),

    // ── April bucket (older month) ──────────────────────────────
    writeAndCommitAtDay(30, 'docs/README-extended.md', 'docs: project README and contributor guide', 2),

    // First feature branch — feat/auth — lives 25-22d ago
    switchToBranch('feat/auth'),
    writeAndCommitAtDay(25, 'src/auth/session.ts', 'feat(auth): session middleware', 3),
    writeAndCommitAtDay(23, 'tests/auth/session.test.ts', 'test: cover session edge cases', 4),

    // Merge feat/auth back to main
    checkoutBranch('main'),
    startMerge('feat/auth', {
      noFastForward: true,
      message: "Merge branch 'feat/auth'",
      date: daysAgo(22),
    }),

    writeAndCommitAtDay(20, 'src/api/errors.ts', 'refactor(api): centralise error shapes', 5),
    writeAndCommitAtDay(16, 'src/api/router.ts', 'fix(api): route precedence for catch-all', 6),

    // ── Last-week bucket (7-13d) ─────────────────────────────────
    writeAndCommitAtDay(13, 'package.json', 'chore(deps): bump simple-git to 4.x', 7),
    writeAndCommitAtDay(12, 'docs/CONTRIBUTING.md', 'docs: contributor guide', 8),

    // Second feature branch — feat/payments — lives 11-7d ago
    switchToBranch('feat/payments'),
    writeAndCommitAtDay(11, 'src/payments/checkout.ts', 'feat(payments): stripe checkout adapter', 9),
    writeAndCommitAtDay(10, 'src/payments/3ds.ts', 'fix(payments): handle 3D-secure redirect', 10),
    writeAndCommitAtDay(9, 'tests/payments/checkout.test.ts', 'test: cover stripe checkout flow', 11),

    checkoutBranch('main'),
    startMerge('feat/payments', {
      noFastForward: true,
      message: "Merge branch 'feat/payments'",
      date: daysAgo(7),
    }),

    // ── This-week bucket (2-6d) ──────────────────────────────────
    writeAndCommitAtDay(6, 'src/api/router.ts', 'perf(api): cache compiled route matcher', 12),
    writeAndCommitAtDay(5, 'src/db/queries.ts', 'fix(db): retry on transient timeout', 13),
    writeAndCommitAtDay(4, 'src/db/migrations/0001_add_index.sql', 'perf(db): index user_id on sessions', 14),

    // Third feature branch — feat/wip — diverged but NOT merged.
    switchToBranch('feat/wip'),
    writeAndCommitAtDay(3, 'src/search/experimental.ts', 'feat(search): experimental trigram backend', 15),
    writeAndCommitAtDay(2, 'src/search/cache.ts', 'chore(search): prototype lookup cache', 16),

    // Back to main for the final stretch + today's commits.
    checkoutBranch('main'),

    // ── Yesterday bucket ─────────────────────────────────────────
    writeAndCommitAtDay(1, 'src/api/router.ts', 'fix!: drop deprecated v1 endpoints', 17),

    // ── Today bucket ─────────────────────────────────────────────
    writeAndCommitAtDay(0, 'src/index.ts', 'chore: tidy imports', 18),
    writeAndCommitAtDay(0, 'src/api/router.ts', 'revert: temporary rollback of v1-shim removal', 19),
    writeAndCommitAtDay(0, 'src/search/index.ts', 'feat(search): trigram-based subject filter', 20),
  ),
})
