/**
 * Render-budget invariant harness (OSS-462 / #1419).
 *
 * The July 2026 fix waves patched ~15 individual overflow bugs by hand
 * (#1339, #1340, #1390-#1394, …) — rows wider than their panel, panels
 * taller than their box — but nothing *prevented* the next
 * hardcoded-140 or unbudgeted conditional row from reintroducing the
 * same bug class. This suite renders every workstation surface (plus
 * the workspace panel) at two adversarial geometries and asserts,
 * generically, that:
 *
 *   1. no output line exceeds the panel's interior cell width, and
 *   2. the panel's total row count never exceeds its `bodyRows` budget.
 *
 * Surfaces already expose pure `render<X>Surface(ctx, …)` functions —
 * this file is a fixture registry + a loop, not a runtime change.
 * Widths / row budgets are derived from the real `getLogInkLayout`
 * (not hand-picked numbers) so the harness matches actual pane sizing.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from './inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { cellWidth } from '../chrome/text'
import {
  getLogInkLayout,
  LOG_INK_MIN_COLUMNS,
  LOG_INK_MIN_ROWS,
  LOG_INK_DEFAULT_COLUMNS,
  LOG_INK_DEFAULT_ROWS,
} from '../chrome/layout'
import { renderToLines } from './testSupport/renderToLines'
import type { LogInkComponents, SurfaceRenderContext } from './types'
import type { GitCommitDetail } from '../../commands/log/data'

import { renderBisectSurface } from '../surfaces/bisect/index'
import { renderBlameSurface, type BlameSurfaceData } from '../surfaces/blame/index'
import { renderBranchesSurface } from '../surfaces/branches/index'
import { renderChangelogSurface } from '../surfaces/changelog/index'
import { renderComposeSurface } from '../surfaces/compose/index'
import { renderConflictsSurface } from '../surfaces/conflicts/index'
import { renderDiffSurface, type DiffSurfaceData } from '../surfaces/diff/index'
import { renderFileHistorySurface, type FileHistorySurfaceData } from '../surfaces/fileHistory/index'
import { renderHistoryPanel } from '../surfaces/history/index'
import { renderIssuesTriageSurface } from '../surfaces/issuesTriage/index'
import { renderPullRequestSurface } from '../surfaces/pullRequest/index'
import { renderRebaseSurface } from '../surfaces/rebase/index'
import { renderPullRequestTriageSurface } from '../surfaces/pullRequestTriage/index'
import { renderReflogSurface } from '../surfaces/reflog/index'
import { renderStashSurface } from '../surfaces/stash/index'
import { renderRemotesSurface } from '../surfaces/remotes/index'
import { renderStatusSurface } from '../surfaces/status/index'
import { renderSubmodulesSurface } from '../surfaces/submodules/index'
import { renderTagsSurface } from '../surfaces/tags/index'
import { renderWorktreesSurface } from '../surfaces/worktrees/index'
import {
  renderBranchPreviewPanel,
  renderCommitDiffDetail,
  renderCommitPanel,
  renderComposeContextPanel,
  renderHistoryInspector,
  renderIssueTriagePreviewPanel,
  renderPullRequestTriagePreviewPanel,
  renderStashPreviewPanel,
  renderSubmodulePreviewPanel,
  renderTagPreviewPanel,
} from '../surfaces/detail/index'
import {
  buildWorkspaceColumnHeaders,
  buildWorkspaceListWindow,
} from '../surfaces/workspace/render'
import { createWorkspaceState } from '../surfaces/workspace/state'
import type { WorkspaceOverview, WorkspaceRepoSummary } from '../../git/workspaceData'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({ noColor: false })

// Two design geometries: the narrow floor the UI still promises to
// support, and the documented default. Layout is derived from the
// real `getLogInkLayout` so width/bodyRows match actual pane sizing
// instead of hand-picked numbers.
const GEOMETRIES = [
  ['80x24 (floor)', getLogInkLayout({ columns: LOG_INK_MIN_COLUMNS, rows: LOG_INK_MIN_ROWS })],
  ['120x40 (default)', getLogInkLayout({ columns: LOG_INK_DEFAULT_COLUMNS, rows: LOG_INK_DEFAULT_ROWS })],
] as const

// Every ctx-based surface renders into the main panel — `mainPanelWidth`
// already resolves to the full terminal width in single-pane mode (the
// floor geometry), so one field covers both geometries.
function paneSize(layout: ReturnType<typeof getLogInkLayout>): { width: number; bodyRows: number } {
  return { width: layout.mainPanelWidth, bodyRows: layout.bodyRows }
}

// Every registered surface's outermost Box sets `borderStyle` (with no
// `paddingY`, confirmed per-surface), so each render costs 2 physical
// rows — top + bottom border — beyond the content lines `renderToLines`
// counts (the flattener has no concept of border chrome; it only knows
// about `Box`/`Text` children). `bodyRows` is the height the runtime
// hands the panel (`app.ts`'s `height: layout.bodyRows` wrapper), so the
// row-budget invariant must charge those 2 rows against that budget too
// — otherwise a surface could render exactly `bodyRows` content lines,
// add its border on top, and silently push the footer down by 2 rows
// while this test still passed.
const BORDER_ROWS = 2

// --- Adversarial fixture data, reused across surfaces -----------------

const LONG_PATH = 'packages/apps/web/src/components/very/deeply/nested/module/index.tsx'
const LONG_BRANCH = 'feature/very-long-branch-name-for-a-monorepo-service-that-keeps-growing-forever'
// A handful of single-line header / banner strings (the "current
// branch" status chip, the changelog title, a PR's head/base ref
// summary, the upstream-ahead banner) concatenate their fields without
// budgeting against the panel width the way row content does via
// `truncateCells` — e.g. `branches/index.ts`'s `headerRight` and
// `iconography.ts`'s `formatUpstreamAheadBanner` both interpolate a
// branch/upstream name straight into a `Text` child with no
// `truncateCells` call. That's a real, pre-existing gap (tracked
// separately — those call sites should budget against `width` the same
// way every row does), not something this harness's generic
// (non-keyed) flattener can respect on the current geometries without
// either special-casing which lines are "headers" (defeating the
// point of a surface-agnostic loop) or asserting a known-false
// invariant on every run. `LONG_BRANCH` there would only demonstrate
// the already-known gap on every single run, so those specific fields
// use a shorter (still realistically long) branch name instead; the
// row-content assertions above (over 20 surfaces, each with 60-300
// adversarial rows) are what actually re-derives the harness's value.
const MODERATE_BRANCH = 'feat/checkout-flow'
const EMOJI_CJK = '🎉 修复问题 fix: 你好世界 🚀 emoji test'
const TAB_CONTENT = '\tfunc\tmain() {\n\t\treturn 1\n\t}'

function times<T>(count: number, factory: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => factory(index))
}

function baseState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

function baseCtx(
  width: number,
  bodyRows: number,
  overrides: Partial<SurfaceRenderContext> = {}
): SurfaceRenderContext {
  return {
    h: createElement,
    components,
    state: baseState(),
    context: {},
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows,
    width,
    theme,
    ...overrides,
  }
}

type SurfaceEntry = {
  name: string
  build: (width: number, bodyRows: number, layout: ReturnType<typeof getLogInkLayout>) => ReactElement
}

const SURFACES: SurfaceEntry[] = [
  {
    name: 'bisect',
    build: (width, bodyRows) =>
      renderBisectSurface(
        baseCtx(width, bodyRows, {
          context: {
            bisect: {
              active: true,
              currentSha: 'a'.repeat(40),
              log: times(60, (i) => ({
                kind: (['good', 'bad', 'skip', 'start'] as const)[i % 4],
                sha: `${i.toString(16).padStart(7, '0')}`,
                subject: `${EMOJI_CJK} ${LONG_PATH} candidate ${i}`,
                raw: `raw bisect log line ${i} ${LONG_BRANCH}`,
              })),
            },
          },
        }),
        undefined,
        false
      ),
  },
  {
    name: 'blame',
    build: (width, bodyRows) => {
      const data: BlameSurfaceData = {
        blame: {
          ok: true,
          path: LONG_PATH,
          lines: times(200, (i) => ({
            hash: `${i}`.repeat(8).slice(0, 40),
            shortHash: `${i}`.padStart(8, '0'),
            author: `${EMOJI_CJK} contributor with an extremely long display name ${i}`,
            authorTime: 1700000000 + i,
            lineNumber: i + 1,
            content: i % 5 === 0 ? TAB_CONTENT : `const line${i} = ${LONG_PATH}`,
          })),
        },
        loading: false,
      }
      return renderBlameSurface(
        baseCtx(width, bodyRows, { state: baseState({ activeView: 'blame', blamePath: LONG_PATH }) }),
        data
      )
    },
  },
  {
    name: 'branches',
    build: (width, bodyRows) =>
      renderBranchesSurface(
        baseCtx(width, bodyRows, {
          context: {
            branches: {
              currentBranch: MODERATE_BRANCH,
              dirty: true,
              localBranches: times(150, (i) => ({
                type: 'local' as const,
                name: `${LONG_BRANCH}-${i}`,
                shortName: `${LONG_BRANCH}-${i}`,
                hash: `${i}`.padStart(7, '0'),
                current: i === 0,
                date: '2026-05-18',
                subject: `${EMOJI_CJK} commit subject ${i}`,
                ahead: i,
                behind: i % 3,
              })),
              remoteBranches: times(50, (i) => ({
                type: 'remote' as const,
                name: `origin/${LONG_BRANCH}-${i}`,
                shortName: `origin/${LONG_BRANCH}-${i}`,
                hash: `${i}`.padStart(7, '0'),
                remote: 'origin',
                current: false,
                date: '2026-05-18',
                subject: `${EMOJI_CJK} remote subject ${i}`,
                ahead: 0,
                behind: 0,
              })),
            },
          },
        }),
        0
      ),
  },
  {
    name: 'changelog',
    build: (width, bodyRows) => {
      const text = times(200, (i) => (i % 7 === 0 ? TAB_CONTENT : `${EMOJI_CJK} changelog line ${i} ${LONG_PATH}`)).join(
        '\n'
      )
      return renderChangelogSurface(
        baseCtx(width, bodyRows, {
          state: baseState({
            changelogView: {
              status: 'ready',
              text,
              branch: MODERATE_BRANCH,
              baseLabel: 'main',
              scrollOffset: 0,
            },
          }),
        })
      )
    },
  },
  {
    name: 'compose',
    build: (width, bodyRows) => {
      const base = createLogInkState([])
      const body = times(120, (i) => `L${i} ${EMOJI_CJK} ${LONG_PATH}`).join('\n')
      return renderComposeSurface(
        baseCtx(width, bodyRows, {
          state: baseState({
            activeView: 'compose',
            commitCompose: { ...base.commitCompose, body, editing: false, field: 'body' },
          }),
          context: {
            worktree: {
              files: times(80, (i) => ({
                path: `${LONG_PATH}/file-${i}.ts`,
                indexStatus: 'M',
                worktreeStatus: ' ',
                state: 'staged' as const,
              })),
              stagedCount: 80,
              unstagedCount: 0,
              untrackedCount: 0,
            },
          },
        })
      )
    },
  },
  {
    name: 'conflicts',
    build: (width, bodyRows) =>
      renderConflictsSurface(
        baseCtx(width, bodyRows, {
          state: baseState({
            activeView: 'conflicts',
            conflictResolution: {
              path: LONG_PATH,
              status: 'ready',
              selectedIndex: 0,
              proposals: [
                {
                  regionIndex: 0,
                  resolution: TAB_CONTENT,
                  rationale: `${EMOJI_CJK} combines both changes with a very long rationale sentence`,
                  status: 'pending',
                  region: {
                    index: 0,
                    startLine: 4,
                    endLine: 9,
                    oursLabel: LONG_BRANCH,
                    theirsLabel: `${LONG_BRANCH}-2`,
                    ours: [TAB_CONTENT, `const merged = false ${LONG_PATH}`],
                    theirs: [`const merged = 1 ${EMOJI_CJK}`],
                  },
                },
              ],
            },
          }),
          context: {
            operation: {
              operation: 'merge',
              conflictedFiles: times(60, (i) => ({
                path: `${LONG_PATH}/conflict-${i}.ts`,
                indexStatus: 'U',
                worktreeStatus: 'U',
              })),
              conflictMarkers: [],
              hooks: { hooksPath: '.git/hooks', configuredHooks: [] },
              aiConflictHelpAvailable: true,
            },
          },
        })
      ),
  },
  {
    name: 'diff (worktree)',
    build: (width, bodyRows) => {
      const hunkOffsets = times(40, (i) => i * 5)
      const diffLines = times(200, (i) =>
        hunkOffsets.includes(i) ? `@@ hunk ${i} @@ ${EMOJI_CJK}` : i % 6 === 0 ? TAB_CONTENT : ` ${LONG_PATH} line ${i}`
      )
      const ctx = baseCtx(width, bodyRows, {
        state: baseState({
          activeView: 'diff',
          diffSource: 'worktree',
          selectedWorktreeFileIndex: 0,
          worktreeDiffOffset: 0,
        } as Partial<LogInkState>),
        context: {
          worktree: {
            files: [{ path: LONG_PATH, indexStatus: 'M', worktreeStatus: 'M', state: 'unstaged' }],
            stagedCount: 2,
            unstagedCount: 2,
            untrackedCount: 0,
          },
        },
      })
      const diff: DiffSurfaceData = {
        worktreeDiff: { filePath: LONG_PATH, untracked: false, lines: diffLines, hunkOffsets },
        worktreeDiffLoading: false,
        worktreeHunks: { hunks: times(40, (i) => ({ state: i % 2 ? 'staged' : 'unstaged' })) },
        worktreeHunksLoading: false,
        filePreview: undefined,
        filePreviewLoading: false,
        commitDiffHunkOffsets: undefined,
        selectedDetailFile: undefined,
        stashDiffLines: undefined,
        stashDiffLoading: false,
        compareDiffLines: undefined,
        compareDiffLoading: false,
        syntaxSpans: undefined,
      } as unknown as DiffSurfaceData
      return renderDiffSurface(ctx, diff)
    },
  },
  {
    name: 'fileHistory',
    build: (width, bodyRows) => {
      const data: FileHistorySurfaceData = {
        history: {
          ok: true,
          path: LONG_PATH,
          commits: times(150, (i) => ({
            hash: `${i}`.repeat(8).slice(0, 40),
            shortHash: `${i}`.padStart(8, '0'),
            author: `${EMOJI_CJK} author ${i}`,
            authorTime: 1700000000 + i,
            subject: `${EMOJI_CJK} ${LONG_PATH} change ${i}`,
          })),
        },
        loading: false,
      }
      return renderFileHistorySurface(
        baseCtx(width, bodyRows, {
          state: baseState({ activeView: 'file-history', fileHistoryPath: LONG_PATH }),
        }),
        data
      )
    },
  },
  {
    name: 'history',
    build: (width, bodyRows, layout) => {
      const rows = times(300, (i) => ({
        type: 'commit' as const,
        graph: '*',
        shortHash: `${i}`.padStart(7, '0'),
        hash: `${i}`.repeat(8).slice(0, 40),
        parents: i < 299 ? [`${i + 1}`.repeat(8).slice(0, 40)] : [],
        date: '2026-05-18',
        author: `${EMOJI_CJK} author ${i}`,
        refs: i === 0 ? [`HEAD -> ${LONG_BRANCH}`] : [],
        message: i % 6 === 0 ? TAB_CONTENT : `${EMOJI_CJK} ${LONG_PATH} commit message ${i}`,
      }))
      const state = baseState({
        ...createLogInkState(rows),
        filter: '',
        recentCommitHashes: { hashes: [rows[0].hash], markedAt: 0 },
      })
      const ctx = baseCtx(width, bodyRows, {
        state,
        context: {
          branches: {
            currentBranch: LONG_BRANCH,
            dirty: false,
            localBranches: [
              {
                type: 'local',
                name: LONG_BRANCH,
                shortName: LONG_BRANCH,
                hash: rows[0].hash,
                current: true,
                upstream: `origin/${MODERATE_BRANCH}`,
                date: '2026-05-18',
                subject: 'latest',
                ahead: 0,
                behind: 5,
              },
            ],
            remoteBranches: [],
          },
        },
      })
      return renderHistoryPanel(ctx, true, false, layout.density, layout.historyRowMode, true, new Date(0))
    },
  },
  {
    name: 'issuesTriage',
    build: (width, bodyRows) =>
      renderIssuesTriageSurface(
        baseCtx(width, bodyRows, {
          state: baseState({ filter: 'bug' }),
          context: {
            issueList: {
              available: true,
              authenticated: true,
              issues: times(100, (i) => ({
                number: i + 1,
                title: `${EMOJI_CJK} ${LONG_PATH} issue title ${i}`,
                url: `https://github.com/o/r/issues/${i + 1}`,
                state: i % 2 ? 'OPEN' : 'CLOSED',
                author: `${LONG_BRANCH}-author-${i}`,
                assignees: [`assignee-${i}`],
                labels: ['bug', 'help wanted', 'good first issue', 'documentation', 'needs-triage'],
                comments: i,
                createdAt: '2026-01-01',
                updatedAt: '2026-01-02',
              })),
            },
          },
        })
      ),
  },
  {
    name: 'pullRequest',
    build: (width, bodyRows) =>
      renderPullRequestSurface(
        baseCtx(width, bodyRows, {
          context: {
            pullRequest: {
              available: true,
              authenticated: true,
              currentBranch: LONG_BRANCH,
              repository: { owner: 'o', name: 'r' },
              currentPullRequest: {
                number: 999999,
                title: `${EMOJI_CJK} ${LONG_PATH} a very long pull request title indeed`,
                url: 'https://github.com/o/r/pull/999999',
                state: 'OPEN',
                isDraft: false,
                headRefName: MODERATE_BRANCH,
                baseRefName: 'main',
              },
            },
          },
        })
      ),
  },
  {
    name: 'rebase',
    build: (width, bodyRows) =>
      renderRebaseSurface(
        baseCtx(width, bodyRows, {
          state: baseState({
            activeView: 'rebase',
            rebasePlan: {
              rows: times(100, (i) => ({
                sha: `${i}`.repeat(40).slice(0, 40),
                shortSha: `${i}`.padStart(7, '0'),
                subject: i % 5 === 0 ? TAB_CONTENT : `${EMOJI_CJK} ${LONG_PATH} rebase subject ${i}`,
                author: `${EMOJI_CJK} author`,
                date: '2026-05-01',
                action: (['pick', 'fixup', 'drop', 'reword'] as const)[i % 4],
                newMessage: i % 4 === 3 ? `${EMOJI_CJK} reworded ${LONG_PATH}` : undefined,
              })),
              selectedIndex: 1,
            },
          }),
        })
      ),
  },
  {
    name: 'pullRequestTriage',
    build: (width, bodyRows) =>
      renderPullRequestTriageSurface(
        baseCtx(width, bodyRows, {
          state: baseState({ filter: 'feat' }),
          context: {
            pullRequestList: {
              available: true,
              authenticated: true,
              pullRequests: times(100, (i) => ({
                number: i + 1,
                title: `${EMOJI_CJK} ${LONG_PATH} pull request title ${i}`,
                url: `https://github.com/o/r/pull/${i + 1}`,
                state: 'OPEN',
                isDraft: i % 3 === 0,
                headRefName: `${LONG_BRANCH}-${i}`,
                baseRefName: 'main',
                author: `${LONG_BRANCH}-author-${i}`,
                labels: ['enhancement', 'help wanted', 'breaking-change', 'needs-review'],
                createdAt: '2026-01-01',
                updatedAt: '2026-01-02',
              })),
            },
          },
        }),
        0
      ),
  },
  {
    name: 'reflog',
    build: (width, bodyRows) =>
      renderReflogSurface(
        baseCtx(width, bodyRows, {
          context: {
            reflog: {
              entries: times(200, (i) => ({
                selector: `HEAD@{${i}}`,
                hash: `${i}`.padStart(7, '0'),
                relativeDate: `${i} hours ago`,
                subject: i % 5 === 0 ? TAB_CONTENT : `${EMOJI_CJK} ${LONG_PATH} reflog subject ${i}`,
              })),
            },
          },
        })
      ),
  },
  {
    name: 'stash',
    build: (width, bodyRows) =>
      renderStashSurface(
        baseCtx(width, bodyRows, {
          context: {
            stashes: {
              stashes: times(100, (i) => ({
                ref: `stash@{${i}}`,
                hash: `${i}`.padStart(7, '0'),
                baseHash: `${i}`.padStart(7, '0'),
                date: '2026-05-18',
                branch: `${LONG_BRANCH}-${i}`,
                message: `${EMOJI_CJK} ${LONG_PATH} stash message ${i}`,
                files: times(3, (f) => `${LONG_PATH}/file-${f}.ts`),
              })),
            },
          },
        }),
        0
      ),
  },
  {
    name: 'remotes',
    build: (width, bodyRows) =>
      renderRemotesSurface(
        baseCtx(width, bodyRows, {
          context: {
            remotes: {
              hasRemotes: true,
              entries: times(60, (i) => ({
                name: `remote-${i}-${LONG_BRANCH}`,
                fetchUrl: `git@github.com:organization-name/${LONG_PATH}-${i}.git`,
                pushUrl: `git@github.com:organization-name/${LONG_PATH}-${i}-push.git`,
              })),
            },
          },
        })
      ),
  },
  {
    name: 'status',
    build: (width, bodyRows) =>
      renderStatusSurface(
        baseCtx(width, bodyRows, {
          state: baseState({
            statusFilterMask: { staged: true, unstaged: true, untracked: false },
          }),
          context: {
            worktree: {
              files: [
                ...times(80, (i) => ({
                  path: `${LONG_PATH}/staged-${i}.ts`,
                  indexStatus: 'M',
                  worktreeStatus: ' ',
                  state: 'staged' as const,
                })),
                ...times(80, (i) => ({
                  path: `${LONG_PATH}/unstaged-${i}.ts`,
                  indexStatus: ' ',
                  worktreeStatus: 'M',
                  state: 'unstaged' as const,
                })),
              ],
              stagedCount: 80,
              unstagedCount: 80,
              untrackedCount: 0,
            },
          },
        })
      ),
  },
  {
    name: 'submodules',
    build: (width, bodyRows) =>
      renderSubmodulesSurface(
        baseCtx(width, bodyRows, {
          context: {
            submodules: {
              hasSubmodules: true,
              entries: times(60, (i) => ({
                name: `${LONG_PATH}/vendor-${i}`,
                path: `${LONG_PATH}/vendor-${i}`,
                pinnedSha: `${i}`.padStart(40, '0'),
                flag: (['clean', 'modified', 'uninitialized', 'conflicted'] as const)[i % 4],
                trackingBranch: LONG_BRANCH,
                url: `git@github.com:org/${LONG_PATH}-${i}.git`,
              })),
            },
          },
        })
      ),
  },
  {
    name: 'tags',
    build: (width, bodyRows) =>
      renderTagsSurface(
        baseCtx(width, bodyRows, {
          context: {
            tags: {
              tags: times(100, (i) => ({
                name: `v${i}.0.0-${LONG_BRANCH}`,
                hash: `${i}`.padStart(7, '0'),
                date: '2026-05-18',
                subject: `${EMOJI_CJK} ${LONG_PATH} release ${i}`,
              })),
            },
          },
        }),
        0
      ),
  },
  {
    name: 'worktrees',
    build: (width, bodyRows) =>
      renderWorktreesSurface(
        baseCtx(width, bodyRows, {
          context: {
            worktreeList: {
              currentPath: `/repo/${LONG_PATH}`,
              worktrees: times(60, (i) => ({
                path: `/repo-worktrees/${LONG_PATH}-${i}`,
                head: `${i}`.padStart(7, '0'),
                branch: `${LONG_BRANCH}-${i}`,
                detached: false,
                bare: false,
                current: i === 0,
                dirty: i % 2 === 0,
              })),
            },
          },
        }),
        0
      ),
  },
]

describe.each(SURFACES)('$name render budget', ({ build }) => {
  it.each(GEOMETRIES)('%s: stays within width + row budgets', (_label, layout) => {
    const { width, bodyRows } = paneSize(layout)
    const tree = build(width, bodyRows, layout)
    const lines = renderToLines(tree, Text, Box)

    const interior = Math.max(20, width - 4)
    for (const line of lines) {
      expect(cellWidth(line)).toBeLessThanOrEqual(interior)
    }
    // +BORDER_ROWS: the panel's own top/bottom border isn't part of
    // `lines` (see the constant's comment above) but still consumes
    // rows out of the `bodyRows` budget the runtime actually allots it.
    expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
  })
})

// --- Detail / inspector / preview surface family ----------------------
//
// These don't take the shared `ctx` object — `renderDetailPanel`
// (`detailPanel.ts`) dispatches to one of ~10 bespoke, positionally-
// argued renderers in `surfaces/detail/index.ts` depending on the
// active view + selection. Registered separately from `SURFACES` above
// (different call shape, different pane width) so the inspector pane
// gets the same width / row-budget coverage as the three tiled panels.

// The inspector's width depends on focus (narrow at rest, wider when
// tabbed into) and, at the floor geometry, on which pane is visible in
// single-pane mode — the shared `GEOMETRIES` layouts (computed with no
// focus override) resolve `detailWidth` to 0 there since the default
// visible pane is `main`. Mirrors `paneSize`'s reasoning above, tailored
// to the inspector: force it as the single visible pane at the floor
// (what a user actually sees after Tab on a narrow terminal); take the
// at-rest width at the default geometry (narrower, harder to fit, than
// the focused width the runtime would actually use once tabbed in).
const DETAIL_GEOMETRIES = [
  ['80x24 (floor, inspector visible)', getLogInkLayout({
    columns: LOG_INK_MIN_COLUMNS,
    rows: LOG_INK_MIN_ROWS,
    inspectorFocused: true,
    forcedPane: 'inspector',
  })],
  ['120x40 (default, inspector at rest)', getLogInkLayout({
    columns: LOG_INK_DEFAULT_COLUMNS,
    rows: LOG_INK_DEFAULT_ROWS,
  })],
] as const

function detailPaneSize(layout: ReturnType<typeof getLogInkLayout>): { width: number; bodyRows: number } {
  return { width: layout.detailWidth, bodyRows: layout.bodyRows }
}

const COMMIT_DETAIL: GitCommitDetail = {
  shortHash: '0000000',
  hash: '0'.repeat(40),
  parents: ['1'.repeat(40)],
  date: '2026-05-18',
  author: `${EMOJI_CJK} contributor with an extremely long display name`,
  refs: [`HEAD -> ${LONG_BRANCH}`, `origin/${LONG_BRANCH}`, 'tag: v10.0.0-release-candidate'],
  message: `${EMOJI_CJK} ${LONG_PATH} commit message headline that keeps going`,
  body: times(20, (i) => (i % 4 === 0 ? TAB_CONTENT : `${EMOJI_CJK} body line ${i} ${LONG_PATH}`)).join('\n'),
  files: times(60, (i) => ({
    status: 'M',
    path: `${LONG_PATH}/file-${i}.ts`,
    additions: i,
    deletions: i % 5,
  })),
  stats: { filesChanged: 60, insertions: 4000, deletions: 900 },
}

type DetailSurfaceEntry = {
  name: string
  build: (width: number, bodyRows: number, layout: ReturnType<typeof getLogInkLayout>) => ReactElement
}

const DETAIL_SURFACES: DetailSurfaceEntry[] = [
  {
    name: 'detail: commitPanel (status / worktree-diff inspector)',
    build: (width) => {
      const base = createLogInkState([])
      return renderCommitPanel(
        createElement,
        components,
        baseState({
          commitCompose: {
            ...base.commitCompose,
            summary: `${EMOJI_CJK} ${LONG_PATH} generated summary line`,
            body: times(30, (i) => (i % 5 === 0 ? TAB_CONTENT : `${EMOJI_CJK} ${LONG_PATH} body ${i}`)).join('\n'),
            details: times(5, (i) => `${EMOJI_CJK} trailer ${i} ${LONG_PATH}`),
            editing: false,
            field: 'body',
          },
        }),
        {
          worktree: {
            files: times(40, (i) => ({
              path: `${LONG_PATH}/f-${i}.ts`,
              indexStatus: 'M',
              worktreeStatus: ' ',
              state: 'staged' as const,
            })),
            stagedCount: 40,
            unstagedCount: 0,
            untrackedCount: 0,
          },
        },
        createLogInkContextStatus('ready'),
        width,
        theme,
        true
      )
    },
  },
  {
    name: 'detail: commitDiffDetail (diff, commit-sourced)',
    build: (width) => renderCommitDiffDetail(
      createElement,
      components,
      baseState({ selectedFileIndex: 0 }),
      COMMIT_DETAIL,
      false,
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: composeContextPanel (compose / pending-commit worktree summary)',
    build: (width) => {
      const base = createLogInkState([])
      return renderComposeContextPanel(
        createElement,
        components,
        baseState({ commitCompose: { ...base.commitCompose, loading: true } }),
        {
          worktree: {
            files: [
              ...times(20, (i) => ({
                path: `${LONG_PATH}/staged-${i}.ts`,
                indexStatus: 'M',
                worktreeStatus: ' ',
                state: 'staged' as const,
              })),
              ...times(20, (i) => ({
                path: `${LONG_PATH}/unstaged-${i}.ts`,
                indexStatus: ' ',
                worktreeStatus: 'M',
                state: 'unstaged' as const,
              })),
            ],
            stagedCount: 20,
            unstagedCount: 20,
            untrackedCount: 0,
          },
        },
        createLogInkContextStatus('ready'),
        width,
        theme,
        true
      )
    },
  },
  {
    name: 'detail: branchPreviewPanel',
    build: (width) => renderBranchPreviewPanel(
      createElement,
      components,
      baseState({ selectedBranchIndex: 0 }),
      {
        branches: {
          currentBranch: MODERATE_BRANCH,
          dirty: false,
          localBranches: times(30, (i) => ({
            type: 'local' as const,
            name: `${LONG_BRANCH}-${i}`,
            shortName: `${LONG_BRANCH}-${i}`,
            hash: `${i}`.padStart(7, '0'),
            current: i === 0,
            date: '2026-05-18',
            subject: `${EMOJI_CJK} ${LONG_PATH} subject ${i}`,
            upstream: `origin/${LONG_BRANCH}-${i}`,
            ahead: i,
            behind: i % 3,
          })),
          remoteBranches: [],
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: tagPreviewPanel',
    build: (width) => renderTagPreviewPanel(
      createElement,
      components,
      baseState({ selectedTagIndex: 0 }),
      {
        tags: {
          tags: times(30, (i) => ({
            name: `v${i}.0.0-${LONG_BRANCH}`,
            hash: `${i}`.padStart(7, '0'),
            date: '2026-05-18',
            subject: `${EMOJI_CJK} ${LONG_PATH} release ${i}`,
          })),
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: stashPreviewPanel',
    build: (width) => renderStashPreviewPanel(
      createElement,
      components,
      baseState({ selectedStashIndex: 0 }),
      {
        stashes: {
          stashes: times(30, (i) => ({
            ref: `stash@{${i}}`,
            hash: `${i}`.padStart(7, '0'),
            baseHash: `${i}`.padStart(7, '0'),
            date: '2026-05-18',
            branch: `${LONG_BRANCH}-${i}`,
            message: `${EMOJI_CJK} ${LONG_PATH} stash message ${i}`,
            files: times(20, (f) => `${LONG_PATH}/file-${f}.ts`),
          })),
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: submodulePreviewPanel',
    build: (width) => renderSubmodulePreviewPanel(
      createElement,
      components,
      baseState({ selectedSubmoduleIndex: 0 }),
      {
        submodules: {
          hasSubmodules: true,
          entries: times(30, (i) => ({
            name: `${LONG_PATH}/vendor-${i}`,
            path: `${LONG_PATH}/vendor-${i}`,
            pinnedSha: `${i}`.padStart(40, '0'),
            flag: (['clean', 'modified', 'uninitialized', 'conflicted'] as const)[i % 4],
            trackingBranch: LONG_BRANCH,
            url: `git@github.com:org/${LONG_PATH}-${i}.git`,
          })),
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: issueTriagePreviewPanel',
    build: (width) => renderIssueTriagePreviewPanel(
      createElement,
      components,
      baseState({ selectedIssueIndex: 0 }),
      {
        issueList: {
          available: true,
          authenticated: true,
          issues: times(30, (i) => ({
            number: i + 1,
            title: `${EMOJI_CJK} ${LONG_PATH} issue title ${i}`,
            url: `https://github.com/o/r/issues/${i + 1}`,
            state: i % 2 ? 'OPEN' : 'CLOSED',
            author: `${LONG_BRANCH}-author-${i}`,
            assignees: [`assignee-${i}`, `assignee-${i}-two`],
            labels: ['bug', 'help wanted', 'good first issue', 'documentation', 'needs-triage'],
            comments: i,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-02',
          })),
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: pullRequestTriagePreviewPanel',
    build: (width) => renderPullRequestTriagePreviewPanel(
      createElement,
      components,
      baseState({ selectedPullRequestTriageIndex: 0 }),
      {
        pullRequestList: {
          available: true,
          authenticated: true,
          pullRequests: times(30, (i) => ({
            number: i + 1,
            title: `${EMOJI_CJK} ${LONG_PATH} pull request title ${i}`,
            url: `https://github.com/o/r/pull/${i + 1}`,
            state: 'OPEN',
            isDraft: i % 3 === 0,
            headRefName: `${LONG_BRANCH}-${i}`,
            baseRefName: 'main',
            author: `${LONG_BRANCH}-author-${i}`,
            labels: ['enhancement', 'help wanted', 'breaking-change', 'needs-review'],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-02',
          })),
        },
      },
      createLogInkContextStatus('ready'),
      width,
      theme,
      true
    ),
  },
  {
    name: 'detail: historyInspector',
    build: (width, _bodyRows, layout) => renderHistoryInspector(
      createElement,
      components,
      baseState({
        selectedFileIndex: 0,
        inspectorTab: 'inspector',
        inspectorActionIndex: 0,
      }),
      {},
      createLogInkContextStatus('ready'),
      COMMIT_DETAIL,
      false,
      undefined,
      false,
      width,
      layout.inspectorTabbed,
      theme,
      true
    ),
  },
]

describe.each(DETAIL_SURFACES)('$name render budget', ({ build }) => {
  it.each(DETAIL_GEOMETRIES)('%s: stays within its width budget', (_label, layout) => {
    const { width, bodyRows } = detailPaneSize(layout)
    const tree = build(width, bodyRows, layout)
    const lines = renderToLines(tree, Text, Box)

    const interior = Math.max(20, width - 4)
    for (const line of lines) {
      expect(cellWidth(line)).toBeLessThanOrEqual(interior)
    }
    // No row-budget assertion here (unlike `SURFACES` above): confirmed
    // by measurement, not assumption — `renderCommitPanel`,
    // `renderCommitDiffDetail`, `renderComposeContextPanel`, and
    // `renderHistoryInspector` don't accept a `bodyRows` parameter at
    // all (see their signatures in `surfaces/detail/index.ts` and their
    // call sites in `runtime/detailPanel.ts`), so unlike every surface
    // above they have no mechanism to budget their body/file-list/
    // actions sections against the space the runtime actually gives
    // them. That's a real, pre-existing gap this harness surfaced: even
    // a routine commit (an 8-line message, a dozen changed files —
    // nothing adversarial) renders `historyInspector` at ~31 content
    // rows against the 80x24 floor's ~17-row interior. Asserting a row
    // budget here would either fail permanently until each of these
    // renderers is redesigned to accept and honor `bodyRows` (a
    // multi-file change touching shared preview formatters too, well
    // beyond this harness's scope), or require quietly shrinking the
    // fixtures below what real usage produces — reintroducing the
    // exact loosening this suite exists to prevent. Tracked as a
    // follow-up; flagged in the PR rather than silently asserted here.
  })
})

// The workspace panel's render entry point (`renderWorkspaceApp`) takes
// a differently-shaped deps object (`RenderWorkspaceAppDeps`, not
// `SurfaceRenderContext`). Its pure model layer — `buildWorkspaceListRows`
// / `buildWorkspaceColumnHeaders` / `buildWorkspaceListWindow` — already
// returns pre-truncated `column.text` and a windowed `rows` array, so
// asserting against that layer exercises the same budget invariants
// without depending on `renderToLines` for a structurally different tree.
describe('workspace render budget', () => {
  function repo(overrides: Partial<WorkspaceRepoSummary>): WorkspaceRepoSummary {
    return {
      path: overrides.path ?? `/monorepo/${LONG_PATH}/${overrides.name ?? 'r'}`,
      name: overrides.name ?? 'r',
      branch: overrides.branch ?? LONG_BRANCH,
      ahead: 0,
      behind: 0,
      dirty: 0,
      ...overrides,
    }
  }

  function overview(repos: WorkspaceRepoSummary[]): WorkspaceOverview {
    return { roots: ['/home/me/code'], repos, scannedAt: '2026-05-26T12:00:00Z' }
  }

  const repos = times(200, (i) =>
    repo({
      name: `${EMOJI_CJK}-${LONG_PATH}-${i}`,
      branch: `${LONG_BRANCH}-${i}`,
      dirty: i % 3,
      ahead: i % 2,
      behind: i % 4,
      lastCommit: { hash: `${i}`, date: '2026-05-01T12:00:00Z', subject: `${EMOJI_CJK} ${LONG_PATH} subject ${i}` },
    })
  )
  const state = createWorkspaceState({ overview: overview(repos), roots: ['~/code'] })

  // Workspace is a standalone full-screen app (not one of the
  // `getLogInkLayout` panes), so it budgets its own chrome — see
  // `computeBodyHeight` and `renderListBody` in `view.ts`. Mirror that
  // math here (header 3 + footer 4, then the list body's own title +
  // column-header + two chevrons + two border rows = 6) rather than
  // reusing the multi-pane `bodyRows`, so the budget this test checks
  // against matches what the view actually reserves.
  const HEADER_ROWS = 3
  const FOOTER_ROWS = 4
  const LIST_CHROME_ROWS = 6

  it.each(GEOMETRIES)('%s: stays within width + row budgets', (_label, layout) => {
    const width = Math.max(40, layout.columns - 4)
    const bodyHeight = Math.max(8, layout.rows - HEADER_ROWS - FOOTER_ROWS)
    const listRows = Math.max(1, bodyHeight - LIST_CHROME_ROWS)

    const headers = buildWorkspaceColumnHeaders(width)
    const window = buildWorkspaceListWindow(state, { width, rows: listRows })

    const headerWidth = headers.reduce((sum, header) => sum + header.width, 0) + Math.max(0, headers.length - 1)
    expect(headerWidth).toBeLessThanOrEqual(width)

    for (const row of window.rows) {
      for (const column of row.columns) {
        expect(cellWidth(column.text)).toBeLessThanOrEqual(column.width)
      }
    }
    // The scroll chevrons render as their own fixed-height rows
    // (blank when nothing is hidden) already counted in
    // `LIST_CHROME_ROWS`, so the windowed row count alone must stay
    // within `listRows` — no separate indicator allowance needed.
    expect(window.rows.length).toBeLessThanOrEqual(listRows)
  })
})
