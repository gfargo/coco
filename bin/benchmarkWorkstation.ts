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
 *   - keystroke → paint latency for j/k scrolling, a view switch,
 *     filter typing, and a repo-frame drill-in
 *   - git subprocess spawns per interaction (the #1364 signal)
 *
 * "Paint" here means the same state + derived view-model computation
 * React would run during a render (`getVisibleLogInkHistory`,
 * `buildFilteredLists`) — this harness never mounts Ink or produces
 * real terminal output, the same approximation `inkInput.test.ts`
 * already relies on to validate behavior without rendering.
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

import { simpleGit, type SimpleGit } from 'simple-git'

import { getLogRows, LOG_INTERACTIVE_DEFAULT_LIMIT, type LogArgv } from '../src/commands/log/data'
import {
  applyLogInkAction,
  createLogInkState,
  type LogInkState,
} from '../src/workstation/runtime/inkViewModel'
import { getLogInkInputEvents, type LogInkInputKey } from '../src/workstation/runtime/inkInput'
import { getVisibleLogInkHistory } from '../src/workstation/chrome/historyRows'
import { buildFilteredLists } from '../src/workstation/runtime/hooks/buildFilteredLists'
import { createRepoFrameRuntime } from '../src/workstation/runtime/repoFrameFactory'
import type { LogInkContext } from '../src/workstation/runtime/types'
import { getBranchOverview } from '../src/git/branchData'
import { getForgePullRequestOverview } from '../src/git/forgeActions'
import { getTagOverview } from '../src/git/tagData'
import { getWorktreeOverview } from '../src/git/statusData'
import { getStashOverview } from '../src/git/stashData'
import { getWorktreeListOverview } from '../src/git/worktreeData'
import { getGitOperationOverview } from '../src/git/operationData'
import { getProviderOverview } from '../src/git/providerData'
import { getReflogOverview } from '../src/git/reflogData'
import { getBisectStatus } from '../src/git/bisectData'
import { getLfsAttributeStatus } from '../src/git/lfsAttributes'
import { getSubmoduleOverview } from '../src/git/submoduleData'
import { getRemoteOverview } from '../src/git/remoteData'

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
}

type FixtureResult = {
  scale: WorkstationFixtureScale
  totalCommits: number
  branchCount: number
  generationMs: number
  phases: PhaseResult[]
}

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

function toPhaseResult(entry: { phase: string; durationMs: number; spawnCount: number }): PhaseResult {
  return { phase: entry.phase, durationMs: entry.durationMs, spawnCount: entry.spawnCount }
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

/**
 * Mirrors `loadLogInkContext` in `src/workstation/runtime/app.ts` —
 * that function is module-private (not exported), and this harness is
 * scoped to land without touching production code, so the same set of
 * boot-time overview fetches is reproduced here from the public
 * building blocks app.ts itself calls.
 */
async function loadWorkstationBootContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider, reflog, bisect, lfs, submodules, remotes] =
    await Promise.all([
      safe(getBranchOverview(git)),
      safe(getForgePullRequestOverview(git)),
      safe(getTagOverview(git)),
      safe(getWorktreeOverview(git)),
      safe(getStashOverview(git)),
      safe(getWorktreeListOverview(git)),
      safe(getGitOperationOverview(git)),
      safe(getProviderOverview(git)),
      safe(getReflogOverview(git)),
      safe(getBisectStatus(git)),
      safe(getLfsAttributeStatus(git)),
      safe(getSubmoduleOverview(git)),
      safe(getRemoteOverview(git)),
    ])

  return {
    bisect,
    branches,
    lfs,
    operation,
    provider,
    pullRequest,
    reflog,
    remotes,
    stashes,
    submodules,
    tags,
    worktree,
    worktreeList,
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

    const boot = await timePhase('boot', async () => {
      const [rows, context] = await Promise.all([
        getLogRows(git, argv, { limit: LOG_INTERACTIVE_DEFAULT_LIMIT }),
        loadWorkstationBootContext(git),
      ])
      return { rows, context }
    })
    phases.push(toPhaseResult(boot))

    let state = createLogInkState(boot.result.rows, {
      repoLabel: scale,
      repoWorkdir: fixture.dir,
    })
    const context = boot.result.context

    const scrollDown = await timePhase('scroll-down', () => {
      for (let i = 0; i < 20; i++) {
        state = applyKeystroke(state, 'j')
        getVisibleLogInkHistory(state, 30)
      }
    })
    phases.push(toPhaseResult(scrollDown))

    const scrollUp = await timePhase('scroll-up', () => {
      for (let i = 0; i < 20; i++) {
        state = applyKeystroke(state, 'k')
        getVisibleLogInkHistory(state, 30)
      }
    })
    phases.push(toPhaseResult(scrollUp))

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
        getVisibleLogInkHistory(state, 30)
      }
    })
    phases.push(toPhaseResult(filterTyping))
    state = applyKeystroke(state, '', { escape: true })
    state = applyKeystroke(state, '', { escape: true })

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
      await loadWorkstationBootContext(frameRuntime.git)
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
      console.log(formatRow(phase.phase, `${phase.durationMs.toFixed(2)}ms  (${phase.spawnCount} git spawns)`))
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
  boot: { maxMs: 4_000, maxSpawns: 80 },
  'scroll-down': { maxMs: 200, maxSpawns: 0 },
  'scroll-up': { maxMs: 200, maxSpawns: 0 },
  'view-switch': { maxMs: 100, maxSpawns: 0 },
  'filter-typing': { maxMs: 200, maxSpawns: 0 },
  'frame-drill-in': { maxMs: 4_000, maxSpawns: 80 },
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
