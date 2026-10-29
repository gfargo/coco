#!/usr/bin/env tsx
/**
 * Workstation keystroke-latency benchmark (#1425).
 *
 * The perf backlog (#1364 subprocess hygiene, #1365 render-path
 * caching) had no acceptance criteria without measurement, and no
 * protection against regressing once fixed. This harness boots the
 * workstation's real reducer/view-model pipeline against synthetic
 * fixture repos at three scales (100 / 5k / 50k commits, wide branch
 * fan-out) and measures:
 *
 *   - cold boot → first paint (the boot-context load + initial log fetch)
 *   - keystroke → paint latency for j/k scrolling in both the single-line
 *     and the stacked (rail) renderers, at the boot depth and again after
 *     paging in up to 20k commits, plus a view switch, filter typing, and
 *     a repo-frame drill-in
 *   - the load-more pager, the branch-cursor anchored fetch, and the
 *     fs-watcher full refresh, each with its git spawn count
 *   - git subprocess spawns per interaction (the #1364 signal)
 *
 * "Paint" here means the same state + derived view-model computation
 * React would run during a render (`getVisibleLogInkHistory`,
 * `buildFilteredLists`) — this harness never mounts Ink or produces
 * real terminal output, the same approximation `inkInput.test.ts`
 * already relies on to validate behavior without rendering.
 *
 * The boot and refresh phases call the runtime's own loaders
 * (`loadLogInkContext`, `getLogRows`, `buildHistoryRefetchArgv`) and the
 * stacked renderer's `fillStackedWindow`, so a refactor that moves or
 * changes them breaks this script at import time instead of letting it
 * drift (#2207). The "50k" fixture only ever measured 1000 rows until the
 * load-more phase started paging it.
 *
 * Usage:
 *   npm run bench:workstation                       # all three scales
 *   npm run bench:workstation -- --update            # also write the baseline
 *   npm run bench:workstation -- --fixture=small     # one scale
 *   npm run bench:workstation -- --fixture=small,medium
 *
 * The small (100-commit) fixture asserts a budget and exits non-zero
 * when exceeded, so it can gate CI; medium/large are report-only —
 * CI hardware isn't guaranteed to sustain them.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { simpleGit } from 'simple-git'

import type { LogArgv } from '../src/commands/log/config'
import {
  COMMIT_CONTEXT_DEFAULT_LIMIT,
  getCommitRows,
  getLogRows,
  getLogRowsAnchoredOn,
  LOG_INTERACTIVE_DEFAULT_LIMIT,
} from '../src/git/logData'
import { getStashCommitHashes } from '../src/git/stashData'
import {
  applyLogInkAction,
  createLogInkState,
  type LogInkState,
} from '../src/workstation/runtime/inkViewModel'
import { getLogInkInputEvents, type LogInkInputKey } from '../src/workstation/runtime/inkInput'
import { getVisibleLogInkHistory } from '../src/workstation/chrome/historyRows'
import { buildFilteredLists } from '../src/workstation/runtime/hooks/buildFilteredLists'
import { loadLogInkContext } from '../src/workstation/runtime/hooks/useContextRefresh'
import { buildHistoryRefetchArgv } from '../src/workstation/runtime/historyRefetchResolver'
import { createRepoFrameRuntime } from '../src/workstation/runtime/repoFrameFactory'
import { fillStackedWindow, stackedItemLineCost } from '../src/workstation/surfaces/history'

import { withSpawnCount } from './lib/gitSpawnCounter'
import {
  generateWorkstationFixture,
  WORKSTATION_FIXTURE_SPECS,
  type WorkstationFixtureScale,
} from './lib/workstationFixtures'

const BENCH_DIR = path.join(process.cwd(), '.bench')
const BASELINE_PATH = path.join(BENCH_DIR, 'workstation-baseline.json')

type PhaseResult = {
  phase: string
  durationMs: number
  spawnCount: number
  /** Context worth printing next to the numbers, e.g. how many commits a paging phase reached. */
  note?: string
}

type FixtureResult = {
  scale: WorkstationFixtureScale
  totalCommits: number
  branchCount: number
  generationMs: number
  phases: PhaseResult[]
}

/** Rows asked of the single-line history renderer, roughly a 40-line terminal. */
const RENDER_ROWS = 30
/** Terminal-line budget handed to the stacked (rail) renderer. */
const RAIL_LINE_BUDGET = 40
/** How deep the load-more phase pages before stopping, matching the issue's 20k-commit scenario. */
const PAGING_TARGET_COMMITS = 20_000
/** Keystrokes per scroll phase. */
const SCROLL_KEYSTROKES = 20

function hrNowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000
}

async function timePhase<T>(
  phase: string,
  fn: () => Promise<T> | T
): Promise<{ phase: string; durationMs: number; spawnCount: number; result: T }> {
  const startedAt = hrNowMs()
  const { result, spawnCount } = await withSpawnCount(fn)
  return { phase, durationMs: hrNowMs() - startedAt, spawnCount, result }
}

function toPhaseResult(
  entry: { phase: string; durationMs: number; spawnCount: number },
  note?: string
): PhaseResult {
  return {
    phase: entry.phase,
    durationMs: entry.durationMs,
    spawnCount: entry.spawnCount,
    ...(note ? { note } : {}),
  }
}

function buildBenchLogArgv(): LogArgv {
  return {
    $0: 'coco',
    _: ['log'],
    all: true,
    interactive: true,
    format: 'table',
    verbose: false,
    version: false,
    help: false,
  } as LogArgv
}

/** Same shape as `inkInput.test.ts`'s local `applyInput` helper — drive one keystroke through the real dispatch pipeline. */
function applyKeystroke(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey = {},
  context: Parameters<typeof getLogInkInputEvents>[3] = {}
): LogInkState {
  return getLogInkInputEvents(state, inputValue, key, context)
    .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
    .reduce((current, event) => applyLogInkAction(current, event.action), state)
}

async function runFixtureBenchmark(scale: WorkstationFixtureScale): Promise<FixtureResult> {
  const fixture = await generateWorkstationFixture(scale)
  try {
    const git = simpleGit(fixture.dir)
    const argv = buildBenchLogArgv()
    const phases: PhaseResult[] = []
    // The renderer's real defaults: the `fullGraphSpacing` row after every
    // commit and the date-bucket dividers are both on, and they are what
    // `renderHistoryPanel` passes (see `surfaces/history/index.ts`).
    const renderOptions = { fullGraphSpacing: true, dateBucketingNow: new Date() }
    // Stacked (rail) rows skip the spacing row, as `renderHistoryPanel` does.
    const railOptions = { dateBucketingNow: renderOptions.dateBucketingNow }

    const boot = await timePhase('boot', async () => {
      const [rows, context] = await Promise.all([
        getLogRows(git, argv, { limit: LOG_INTERACTIVE_DEFAULT_LIMIT }),
        loadLogInkContext(git),
      ])
      return { rows, context }
    })
    phases.push(toPhaseResult(boot))

    let state = createLogInkState(boot.result.rows, {
      repoLabel: scale,
      repoWorkdir: fixture.dir,
    })
    const context = boot.result.context

    const scrollPhase = async (
      phase: string,
      key: string,
      render: () => unknown
    ): Promise<void> => {
      const timed = await timePhase(phase, () => {
        for (let i = 0; i < SCROLL_KEYSTROKES; i++) {
          state = applyKeystroke(state, key)
          render()
        }
      })
      phases.push(toPhaseResult(timed, `${state.commits.length} commits loaded`))
    }
    const renderSingle = () => getVisibleLogInkHistory(state, RENDER_ROWS, renderOptions)
    const renderRail = () =>
      fillStackedWindow(state, RAIL_LINE_BUDGET, railOptions, (item) =>
        stackedItemLineCost(item, {
          fullGraph: state.fullGraph,
          bucketed: Boolean(railOptions.dateBucketingNow),
        })
      )

    await scrollPhase('scroll-down', 'j', renderSingle)
    await scrollPhase('scroll-up', 'k', renderSingle)
    await scrollPhase('rail-scroll', 'j', renderRail)
    await scrollPhase('rail-scroll-up', 'k', renderRail)

    const viewSwitch = await timePhase('view-switch', () => {
      // `g` `b` — the which-key chord that jumps to the branches view.
      state = applyKeystroke(state, 'g')
      state = applyKeystroke(state, 'b')
      buildFilteredLists(context, state.filter, { branchSort: state.branchSort, tagSort: state.tagSort })
    })
    phases.push(toPhaseResult(viewSwitch))
    // Back to history before the next phases, mirroring real navigation.
    state = applyKeystroke(state, 'g')
    state = applyKeystroke(state, 'h')

    const filterTyping = await timePhase('filter-typing', () => {
      state = applyKeystroke(state, '/')
      for (const char of 'fix') {
        state = applyKeystroke(state, char)
        buildFilteredLists(context, state.filter, { branchSort: state.branchSort, tagSort: state.tagSort })
        getVisibleLogInkHistory(state, RENDER_ROWS, renderOptions)
      }
    })
    phases.push(toPhaseResult(filterTyping))
    state = applyKeystroke(state, '', { escape: true })
    state = applyKeystroke(state, '', { escape: true })

    // Mirrors `loadMoreCommits` in `useLoadMoreHistory`: page forward by the
    // main-ordering offset (#1337) with the stash hashes as extra roots,
    // appending each page, until the target depth or the end of history.
    // The stash hashes are re-read for every page, as the real loader does.
    const loadMore = await timePhase('load-more', async () => {
      let hasMore = state.commits.length >= LOG_INTERACTIVE_DEFAULT_LIMIT
      while (hasMore && state.commits.length < PAGING_TARGET_COMMITS) {
        const stashHashes = await getStashCommitHashes(git).catch(() => [])
        const page = await getLogRows(git, argv, {
          limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
          skip: state.mainHistoryCommitCount,
          extraRefs: stashHashes,
        })
        const pageCommits = getCommitRows(page).length
        if (page.length > 0) {
          state = applyLogInkAction(state, {
            type: 'appendRows',
            rows: page,
            mainOrderingCount: pageCommits,
          })
        }
        hasMore = pageCommits >= LOG_INTERACTIVE_DEFAULT_LIMIT
      }
    })
    phases.push(toPhaseResult(loadMore, `${state.commits.length} commits loaded`))

    // The same keystrokes again, now over the deep list: this is where
    // render cost that grows with the loaded window (#2208) shows up.
    await scrollPhase('scroll-at-depth', 'j', renderSingle)
    await scrollPhase('rail-scroll-at-depth', 'j', renderRail)

    // Mirrors `loadCommitContext`: the user cursors a branch whose target
    // commit is far outside the loaded window, so an anchored `git log`
    // runs and its rows are merged in. Resolving the target is setup, not
    // the interaction, so it stays outside the timed region.
    const branchCommitTotal = fixture.spec.branchCount * fixture.spec.commitsPerBranch
    const mainCommits = Math.max(fixture.spec.totalCommits - branchCommitTotal, 1)
    const anchorHash = (await git.revparse([`main~${Math.floor((mainCommits - 1) * 0.9)}`])).trim()
    const cursorSync = await timePhase('cursor-sync', async () => {
      const rows = await getLogRowsAnchoredOn(git, argv, anchorHash, {
        limit: COMMIT_CONTEXT_DEFAULT_LIMIT,
      })
      if (rows.length > 0) {
        state = applyLogInkAction(state, { type: 'appendRows', rows })
      }
      getVisibleLogInkHistory(state, RENDER_ROWS, renderOptions)
    })
    phases.push(toPhaseResult(cursorSync, `${state.commits.length} commits loaded`))

    // What an fs-watcher `'full'` event runs (`useRefreshWatcher`): a silent
    // context refresh plus a history refresh that replaces the head window.
    const watcherRefresh = await timePhase('watcher-refresh', async () => {
      const [, fresh] = await Promise.all([
        loadLogInkContext(git, { silent: true }),
        (async () => {
          const stashHashes = await getStashCommitHashes(git).catch(() => [])
          return getLogRows(git, buildHistoryRefetchArgv(argv, state.fullGraph, undefined), {
            limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
            extraRefs: stashHashes,
          })
        })(),
      ])
      state = applyLogInkAction(state, { type: 'replaceRows', rows: fresh })
    })
    phases.push(toPhaseResult(watcherRefresh))

    const drillIn = await timePhase('frame-drill-in', async () => {
      // Synthetic fixtures don't carry real submodules, so the drill-in
      // target here is the same fixture directory rather than a
      // resolved submodule path — the mechanics measured (the reducer's
      // `pushRepoFrame` push, `createRepoFrameRuntime`'s `simpleGit`
      // resolution, and the new frame's boot-context load) are the
      // exact functions a real drill-in exercises.
      state = applyLogInkAction(state, {
        type: 'pushRepoFrame',
        label: 'nested-fixture',
        workdir: fixture.dir,
      })
      const activeFrame = state.repoStack[state.repoStack.length - 1]
      const frameRuntime = createRepoFrameRuntime(activeFrame, git)
      await loadLogInkContext(frameRuntime.git)
    })
    phases.push(toPhaseResult(drillIn))

    return {
      scale,
      totalCommits: fixture.spec.totalCommits,
      branchCount: fixture.spec.branchCount,
      generationMs: fixture.generationMs,
      phases,
    }
  } finally {
    fixture.cleanup()
  }
}

function formatRow(label: string, value: string): string {
  return `  ${label.padEnd(20)} ${value}`
}

function printSummary(results: FixtureResult[], baseline?: FixtureResult[]): void {
  console.log('\n=== workstation keystroke-latency benchmark ===\n')
  for (const result of results) {
    console.log(
      `Fixture: ${result.scale}  (${result.totalCommits} commits, ${result.branchCount} branches, fixture generated in ${result.generationMs}ms)`
    )
    const priorFixture = baseline?.find((entry) => entry.scale === result.scale)
    for (const phase of result.phases) {
      console.log(
        formatRow(
          phase.phase,
          `${phase.durationMs.toFixed(2)}ms  (${phase.spawnCount} git spawns)${phase.note ? `  [${phase.note}]` : ''}`
        )
      )
      const prior = priorFixture?.phases.find((entry) => entry.phase === phase.phase)
      if (prior) {
        const deltaMs = phase.durationMs - prior.durationMs
        const deltaPct = prior.durationMs === 0 ? 'n/a' : `${((deltaMs / prior.durationMs) * 100).toFixed(1)}%`
        console.log(
          formatRow(`Δ ${phase.phase}`, `${deltaMs.toFixed(2)}ms (${deltaPct}), spawns ${phase.spawnCount - prior.spawnCount >= 0 ? '+' : ''}${phase.spawnCount - prior.spawnCount}`)
        )
      }
    }
    console.log('')
  }
}

function writeBenchFile(results: FixtureResult[], updateBaseline: boolean): void {
  if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR, { recursive: true })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runFile = path.join(BENCH_DIR, `workstation-run-${stamp}.json`)
  const payload = {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    results,
  }
  fs.writeFileSync(runFile, JSON.stringify(payload, null, 2))
  console.log(`Wrote ${runFile}`)

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2))
    console.log(`Updated baseline at ${BASELINE_PATH}`)
  }
}

function readBaseline(): FixtureResult[] | undefined {
  if (!fs.existsSync(BASELINE_PATH)) return undefined
  try {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.results) ? parsed.results : undefined
  } catch {
    return undefined
  }
}

/**
 * Budgets for the 100-commit fixture only (#1425 scope — medium/large
 * are report-only since CI hardware isn't guaranteed to sustain them).
 * The interaction phases (everything but boot/frame-drill-in) assert
 * ZERO git spawns: they're pure state + derived-view-model computation
 * with no I/O, so any spawn there is a regression. Timing ceilings are
 * deliberately generous to avoid flaking on throttled CI runners.
 */
const SMALL_FIXTURE_BUDGET: Record<string, { maxMs: number; maxSpawns: number }> = {
  boot: { maxMs: 10_000, maxSpawns: 80 },
  'scroll-down': { maxMs: 500, maxSpawns: 0 },
  'scroll-up': { maxMs: 500, maxSpawns: 0 },
  'rail-scroll': { maxMs: 2_000, maxSpawns: 0 },
  'rail-scroll-up': { maxMs: 2_000, maxSpawns: 0 },
  'view-switch': { maxMs: 500, maxSpawns: 0 },
  'filter-typing': { maxMs: 500, maxSpawns: 0 },
  // 100 commits never fills a page, so there is nothing to page in.
  'load-more': { maxMs: 2_000, maxSpawns: 0 },
  'scroll-at-depth': { maxMs: 500, maxSpawns: 0 },
  'rail-scroll-at-depth': { maxMs: 2_000, maxSpawns: 0 },
  'cursor-sync': { maxMs: 4_000, maxSpawns: 2 },
  // A watcher event refreshes the whole context plus the head of the log.
  // The ceiling sits just above today's count so a regression fails; the
  // perf work in #2209 should ratchet it down.
  'watcher-refresh': { maxMs: 10_000, maxSpawns: 40 },
  'frame-drill-in': { maxMs: 10_000, maxSpawns: 80 },
}

function checkBudget(result: FixtureResult): boolean {
  if (result.scale !== 'small') return true

  let withinBudget = true
  for (const phase of result.phases) {
    const budget = SMALL_FIXTURE_BUDGET[phase.phase]
    if (!budget) continue
    if (phase.durationMs > budget.maxMs || phase.spawnCount > budget.maxSpawns) {
      withinBudget = false
      console.error(
        `OVER BUDGET: ${result.scale}/${phase.phase} — ${phase.durationMs.toFixed(2)}ms (max ${budget.maxMs}ms), ${phase.spawnCount} git spawns (max ${budget.maxSpawns})`
      )
    }
  }
  return withinBudget
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes('--update')
  const fixtureArg = args.find((arg) => arg.startsWith('--fixture='))?.split('=')[1]
  const requestedScales = fixtureArg
    ? fixtureArg.split(',').map((entry) => entry.trim())
    : (Object.keys(WORKSTATION_FIXTURE_SPECS) as WorkstationFixtureScale[])

  const invalid = requestedScales.filter((scale) => !(scale in WORKSTATION_FIXTURE_SPECS))
  if (invalid.length > 0) {
    console.error(
      `Unknown fixture scale(s): ${invalid.join(', ')}; available: ${Object.keys(WORKSTATION_FIXTURE_SPECS).join(', ')}`
    )
    process.exitCode = 1
    return
  }
  const scales = requestedScales as WorkstationFixtureScale[]

  const results: FixtureResult[] = []
  for (const scale of scales) {
    console.log(`Running ${scale} fixture...`)
    const result = await runFixtureBenchmark(scale)
    results.push(result)
  }

  const baseline = updateBaseline ? undefined : readBaseline()
  printSummary(results, baseline)
  writeBenchFile(results, updateBaseline)

  const allWithinBudget = results.every((result) => checkBudget(result))
  if (!allWithinBudget) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
