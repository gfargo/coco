#!/usr/bin/env tsx
/**
 * Diff-condensing pipeline benchmark (#845).
 *
 * Runs `summarizeDiffs` against the synthetic fixtures in
 * `src/lib/parsers/default/__fixtures__/index.ts` using a mock LLM
 * chain that simulates latency proportional to input size. Captures
 * stage timings and per-call telemetry, writes the result to
 * `.bench/<timestamp>.json`, and (when a baseline is present at
 * `.bench/baseline.json`) prints a diff so PRs can show their wins
 * concretely.
 *
 * Usage:
 *   npm run bench                # run all fixtures, write bench file
 *   npm run bench -- --update    # also overwrite the baseline
 *   npm run bench -- --fixture=medium   # narrow to one fixture
 *
 * The mock chain uses a deterministic latency model so before/after
 * runs compare apples to apples without paying for real API calls.
 * Numbers don't reflect real-world wall-clock time; they reflect the
 * pipeline's *behavior* (how many calls fire, how the stages fan
 * out, where the bottlenecks are).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { loadSummarizationChain } from '@langchain/classic/chains'
import type { Document } from '@langchain/classic/document'

import { fileChangeParser } from '../src/lib/parsers/default'
import { summarizeDiffs } from '../src/lib/parsers/default/utils/summarizeDiffs'
import { clearDiffSummaryCache } from '../src/lib/parsers/default/utils/diffSummaryCache'
import { allFixtures, DiffFixture } from '../src/lib/parsers/default/__fixtures__'
import { Logger } from '../src/lib/utils/logger'
import { getTokenCounter } from '../src/lib/utils/tokenizer'
import {
  buildLlmBenchRun,
  flushLlmBenchRun,
  resetLlmTelemetry,
} from '../src/lib/langchain/utils/observability'

// Silence the type checker about the unused `fileChangeParser` import
// being present for future bench scenarios; the active runner uses
// `summarizeDiffs` directly so it can pass a pre-built DiffNode.
void fileChangeParser

const BENCH_DIR = path.join(process.cwd(), '.bench')
const BASELINE_PATH = path.join(BENCH_DIR, 'baseline.json')

// The bench runner is the canonical "I want telemetry" entry point,
// so flip COCO_BENCH on in-process if the user didn't set it
// externally. `recordBenchCall` checks this env var to decide
// whether to retain per-call data.
if (!process.env.COCO_BENCH) {
  process.env.COCO_BENCH = '1'
}

type BenchOptions = {
  baseLatencyMs: number
  perTokenMs: number
  maxConcurrent: number
  maxTokens: number
  /**
   * Opt-in fast paths to enable for this run. Off by default so the
   * bench reflects production defaults; flip on via `--fast-path=markdown`
   * to measure the lossy markdown skip (#861, angle 5).
   */
  fastPath?: {
    markdown?: boolean
  }
}

const DEFAULT_OPTIONS: BenchOptions = {
  // Calibrated to roughly match user-reported wall-clock on
  // gpt-4.1-nano: ~3-7s for small calls, scaling up to ~25-40s for
  // multi-thousand-token inputs. Adjust if real-world timings drift.
  baseLatencyMs: 1500,
  perTokenMs: 2,
  // Match the canonical service maxConcurrent from
  // `langchain/utils.ts` (raised 12 → 24 in PR 3 of #845). The
  // bench mirrors the most-common production setting so per-PR
  // diffs reflect what real users see.
  maxConcurrent: 24,
  // Match the canonical service tokenLimit from `langchain/utils.ts`
  // (raised from 2048 to 4096 in PR 1 of #845).
  maxTokens: 4096,
}

type BenchResult = {
  fixture: string
  fileCount: number
  approxTokens: number
  durationMs: number
  llmCalls: number
  llmTotalMs: number
  llmTotalPromptTokens: number
  /** When this row is a warm-cache re-run, the cold result it amortized against. */
  pass?: 'cold' | 'warm'
}

/**
 * Deterministic hash of the chain input. Used to derive per-call
 * latency variance so the bench mirrors real-world LLM tail
 * behavior without sacrificing reproducibility (same input ⇒ same
 * latency every run).
 */
function inputHash(documents: Document[]): number {
  const sample = documents.map((doc) => doc.pageContent).join('')
  let h = 5381
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) + h + sample.charCodeAt(i)) >>> 0
  }
  return h
}

function mockChain(options: BenchOptions): unknown {
  // Duck-typed chain that satisfies the .invoke() shape
  // `summarize()` expects.
  //
  // Latency model (#845, PR 4): a base + per-token term, plus a
  // deterministic tail-variance multiplier. ~10% of calls land in
  // a 3x slow bucket and ~3% in a 6x slow bucket, mirroring the
  // real-world LLM behavior the user's #845 verbose log exhibited
  // (one 98 s call dominating an otherwise-fast wave). The
  // multiplier is keyed on the input hash so the same call shape
  // always gets the same latency — bench remains reproducible
  // while surfacing scheduler pathologies the uniform model hid.
  return {
    invoke: async (input: { input_documents: Document[] }) => {
      const totalChars = input.input_documents.reduce(
        (sum, doc) => sum + doc.pageContent.length,
        0
      )
      const approxTokens = Math.floor(totalChars / 4)
      const baseLatency = options.baseLatencyMs + Math.floor(approxTokens * options.perTokenMs)
      const bucket = inputHash(input.input_documents) % 100
      const tailMultiplier = bucket < 3 ? 6 : bucket < 13 ? 3 : 1
      const latencyMs = baseLatency * tailMultiplier
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
      return { text: `[mock summary of ${input.input_documents.length} doc(s), ~${approxTokens} tokens]` }
    },
  }
}

function silentLogger(): Logger {
  // Tests already use this pattern; keep verbose calls a no-op so the
  // bench output stays clean while still funneling timer + spinner
  // calls through the real Logger surface.
  const logger = new Logger({ verbose: false } as never)
  return logger
}

async function runFixture(
  fixture: DiffFixture,
  options: BenchOptions
): Promise<BenchResult> {
  resetLlmTelemetry()

  const tokenizer = await getTokenCounter('gpt-4.1-nano')
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 10000,
    chunkOverlap: 250,
  })
  const chain = mockChain(options) as Parameters<typeof summarizeDiffs>[1]['chain']
  const logger = silentLogger()

  const startedAt = Date.now()
  await summarizeDiffs(fixture.rootNode, {
    tokenizer,
    logger,
    maxTokens: options.maxTokens,
    minTokensForSummary: 400,
    maxFileTokens: Math.floor(options.maxTokens * 0.25),
    maxConcurrent: options.maxConcurrent,
    fastPath: options.fastPath,
    textSplitter,
    chain,
    metadata: { command: 'benchmark', model: 'mock' },
  })
  const durationMs = Date.now() - startedAt

  const run = buildLlmBenchRun({ command: `bench:${fixture.name}`, totalElapsedMs: durationMs })

  return {
    fixture: fixture.name,
    fileCount: fixture.fileCount,
    approxTokens: fixture.approxTokens,
    durationMs,
    llmCalls: run.callCount,
    llmTotalMs: run.totalLlmElapsedMs,
    llmTotalPromptTokens: run.totalPromptTokens,
  }
}

function formatRow(label: string, value: string | number): string {
  return `  ${label.padEnd(28)} ${value}`
}

function printSummary(results: BenchResult[], baseline?: BenchResult[]): void {
  console.log('\n=== diff-condensing benchmark ===\n')
  for (const result of results) {
    const passLabel = result.pass ? ` (${result.pass})` : ''
    console.log(`Fixture: ${result.fixture}${passLabel}  (${result.fileCount} files, ~${result.approxTokens} tokens)`)
    console.log(formatRow('wall-clock duration', `${result.durationMs}ms`))
    console.log(formatRow('llm calls', result.llmCalls))
    console.log(formatRow('llm total time', `${result.llmTotalMs}ms`))
    console.log(formatRow('llm prompt tokens', result.llmTotalPromptTokens))
    if (baseline) {
      // For repeat runs, only diff cold pass against baseline so warm
      // numbers don't muddy the headline regression check.
      const matchPass = result.pass ?? undefined
      const prior = baseline.find(
        (entry) => entry.fixture === result.fixture && (entry.pass ?? undefined) === matchPass
      )
      if (prior) {
        const deltaPct = (n: number, p: number) =>
          p === 0 ? 'n/a' : `${(((n - p) / p) * 100).toFixed(1)}%`
        console.log(formatRow('Δ duration', `${result.durationMs - prior.durationMs}ms (${deltaPct(result.durationMs, prior.durationMs)})`))
        console.log(formatRow('Δ llm calls', `${result.llmCalls - prior.llmCalls} (${deltaPct(result.llmCalls, prior.llmCalls)})`))
      }
    }
    console.log('')
  }
}

function writeBenchFile(results: BenchResult[], updateBaseline: boolean): void {
  if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR, { recursive: true })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runFile = path.join(BENCH_DIR, `run-${stamp}.json`)
  const payload = {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    options: DEFAULT_OPTIONS,
    results,
  }
  fs.writeFileSync(runFile, JSON.stringify(payload, null, 2))
  console.log(`Wrote ${runFile}`)

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2))
    console.log(`Updated baseline at ${BASELINE_PATH}`)
  }
}

function readBaseline(): BenchResult[] | undefined {
  if (!fs.existsSync(BASELINE_PATH)) return undefined
  try {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.results) ? parsed.results : undefined
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes('--update')
  const fixtureArg = args.find((arg) => arg.startsWith('--fixture='))?.split('=')[1]
  // --repeat runs each fixture twice: a cold pass (cache cleared
  // beforehand) and a warm pass (cache populated by the cold pass).
  // Demonstrates the cache hit rate added in #845 PR 5 — same fixture,
  // unchanged inputs, second run should be essentially free.
  const repeat = args.includes('--repeat')
  // --no-cache disables the diff-summary cache for the run. Useful
  // for reproducing pre-PR-5 numbers against the same harness.
  if (args.includes('--no-cache')) {
    process.env.COCO_NO_CACHE = '1'
  }
  // --fast-path=<name>[,<name>] enables opt-in fast paths for the
  // run (#861, angle 5). Default is off so bench numbers track
  // production defaults; pass `--fast-path=markdown` to measure the
  // markdown skip's impact on docs-update-shaped fixtures.
  const fastPathArg = args.find((arg) => arg.startsWith('--fast-path='))?.split('=')[1]
  const fastPath = fastPathArg
    ? Object.fromEntries(fastPathArg.split(',').map((name) => [name.trim(), true]))
    : undefined
  const runOptions: BenchOptions = { ...DEFAULT_OPTIONS, fastPath }

  const fixtures = fixtureArg
    ? allFixtures.filter((fixture) => fixture.name === fixtureArg)
    : allFixtures
  if (fixtures.length === 0) {
    console.error(`No fixture matched ${fixtureArg}; available: ${allFixtures.map((f) => f.name).join(', ')}`)
    process.exitCode = 1
    return
  }

  const results: BenchResult[] = []
  for (const fixture of fixtures) {
    if (repeat) {
      // Cold pass: clear the cache for this repo first so the run
      // can't piggyback on a prior bench.
      clearDiffSummaryCache(process.cwd())
      console.log(`Running fixture ${fixture.name} (cold)...`)
      const cold = await runFixture(fixture, runOptions)
      results.push({ ...cold, pass: 'cold' })

      console.log(`Running fixture ${fixture.name} (warm)...`)
      const warm = await runFixture(fixture, runOptions)
      results.push({ ...warm, pass: 'warm' })
    } else {
      console.log(`Running fixture ${fixture.name}...`)
      const result = await runFixture(fixture, runOptions)
      results.push(result)
    }
  }

  const baseline = updateBaseline ? undefined : readBaseline()
  printSummary(results, baseline)
  writeBenchFile(results, updateBaseline)

  // Flush any in-memory bench telemetry to a separate file when
  // COCO_BENCH is set externally; lets devs capture the per-call
  // data alongside the aggregated results.
  flushLlmBenchRun({ command: 'benchmark' })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
