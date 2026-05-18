#!/usr/bin/env tsx
/**
 * CLI driver for the structural-extract eval (#934).
 *
 * Walks the scenario library, builds a `FileDiff[]` per commit, and
 * runs each scenario through the structural-extract A/B harness
 * (baseline vs. languageAware-enabled). Writes a per-scenario JSON
 * result plus a Markdown summary into `.bench/structural-extract-eval/
 * <timestamp>/`, and prints an aggregate table to stdout.
 *
 * Usage:
 *   npm run eval:structural-extract                       # all scenarios
 *   npm run eval:structural-extract -- --scenario X       # one scenario
 *   npm run eval:structural-extract -- --languages ts,js  # narrow opt-in
 *   npm run eval:structural-extract -- --out <dir>        # custom output
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import {
  EvalRunConfig,
  StructuralLanguageId,
  renderEvalReportMarkdown,
  runStructuralExtractEval,
} from '../src/lib/parsers/default/__evals__/structuralExtractEval'
import { evalFixtures } from '../src/lib/parsers/default/__evals__/fixtures'
import { buildScenarioFixtures } from '../src/lib/parsers/default/__evals__/scenarioInputs'
import { allScenarios } from '@gfargo/git-scenarios'

type CliArgs = {
  scenarios: string[]
  /** When true (default), include the hand-crafted fixtures in the run. */
  includeFixtures: boolean
  /** When true, skip the scenario adapter and run fixtures only. */
  fixturesOnly: boolean
  languages: StructuralLanguageId[]
  outDir: string
  help: boolean
}

const KNOWN_LANGUAGES = new Set<StructuralLanguageId>(['ts', 'js', 'py', 'rs', 'go'])

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenarios: [],
    includeFixtures: true,
    fixturesOnly: false,
    languages: [],
    outDir: '',
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === '--help' || value === '-h') {
      args.help = true
    } else if (value === '--scenario') {
      const next = argv[++i]
      if (next) args.scenarios.push(next)
    } else if (value === '--no-fixtures') {
      args.includeFixtures = false
    } else if (value === '--fixtures-only') {
      args.fixturesOnly = true
    } else if (value === '--languages') {
      const next = argv[++i] || ''
      for (const lang of next.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (KNOWN_LANGUAGES.has(lang as StructuralLanguageId)) {
          args.languages.push(lang as StructuralLanguageId)
        } else {
          console.error(`! Unknown language "${lang}" — ignored. Known: ${[...KNOWN_LANGUAGES].join(', ')}`)
        }
      }
    } else if (value === '--out') {
      const next = argv[++i]
      if (next) args.outDir = next
    }
  }
  return args
}

function printHelp(): void {
  console.log(`structural-extract eval (#934)

Usage:
  npm run eval:structural-extract                       run all scenarios + fixtures
  npm run eval:structural-extract -- --scenario NAME    run one scenario
  npm run eval:structural-extract -- --fixtures-only    skip scenarios (fast)
  npm run eval:structural-extract -- --no-fixtures      scenarios only
  npm run eval:structural-extract -- --languages ts,js  narrow opt-in
  npm run eval:structural-extract -- --out DIR          custom output dir

Output:
  Per-input JSON + Markdown reports under .bench/structural-extract-eval/<timestamp>/.
  Aggregate summary printed to stdout.

Inputs:
  - Scenarios: deterministic git states from `@gfargo/git-scenarios`
    (these mostly trigger the lossless trivial-shape path; useful for
    "what does the natural distribution look like").
  - Fixtures: hand-crafted modification diffs in __evals__/fixtures.ts
    that target the language-aware path specifically.

Scenarios: ${allScenarios.map((s) => s.name).join(', ')}
Fixtures:  ${evalFixtures.map((f) => f.name).join(', ')}
`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return 0
  }

  const scenarioTarget = args.fixturesOnly
    ? []
    : args.scenarios.length > 0
      ? args.scenarios
      : allScenarios.map((s) => s.name)
  const fixtureTarget = args.includeFixtures || args.fixturesOnly
    ? evalFixtures
    : []

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.outDir || path.join('.bench', 'structural-extract-eval', timestamp)
  mkdirSync(outDir, { recursive: true })

  const configs: EvalRunConfig[] = [
    { label: 'baseline' },
    {
      label: args.languages.length > 0
        ? `languageAware(${args.languages.join(',')})`
        : 'languageAware-all',
      fastPath: {
        languageAware: {
          enabled: true,
          ...(args.languages.length > 0 ? { languages: args.languages } : {}),
        },
      },
    },
  ]

  // Aggregate totals across scenarios — printed at the end so the user
  // sees the top-line impact without having to read every file.
  let aggregateBaselineCalls = 0
  let aggregateEnabledCalls = 0
  let aggregateFastPathHits = 0
  let aggregateInputFiles = 0

  console.log(`\nstructural-extract eval — ${timestamp}\n`)
  console.log(`output: ${outDir}\n`)
  console.log(`configs:`)
  for (const config of configs) console.log(`  - ${config.label}`)
  console.log('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function recordReport(kind: 'scenario' | 'fixture', name: string, report: any): void {
    aggregateInputFiles += report.inputFileCount
    if (report.runs[0]) aggregateBaselineCalls += report.runs[0].llmCalls
    if (report.runs[1]) aggregateEnabledCalls += report.runs[1].llmCalls
    if (report.deltas[0]) aggregateFastPathHits += report.deltas[0].fastPathHitCount

    const slug = `${kind}-${name}`
    writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(report, null, 2))
    writeFileSync(
      path.join(outDir, `${slug}.md`),
      renderEvalReportMarkdown(report, `structural-extract eval — ${kind} · ${name}`),
    )
    const saved = report.deltas[0]?.llmCallsSaved ?? 0
    const hits = report.deltas[0]?.fastPathHitCount ?? 0
    console.log(
      `${report.inputFileCount} files · ${report.runs[0]?.llmCalls ?? 0} → ${report.runs[1]?.llmCalls ?? 0} LLM calls (saved ${saved}, fast-path hits ${hits})`,
    )
  }

  for (const scenarioName of scenarioTarget) {
    process.stdout.write(`· scenario ${scenarioName} … `)
    let repoCleanup: (() => Promise<void>) | undefined
    try {
      const { repo, fixtures } = await buildScenarioFixtures(scenarioName)
      repoCleanup = () => repo.cleanup()
      const diffs = fixtures.commits.flatMap((c) => c.diffs)
      const report = await runStructuralExtractEval(diffs, configs)
      recordReport('scenario', scenarioName, report)
    } catch (error) {
      console.log(`error: ${(error as Error).message}`)
    } finally {
      if (repoCleanup) await repoCleanup()
    }
  }

  for (const fixture of fixtureTarget) {
    process.stdout.write(`· fixture  ${fixture.name} … `)
    try {
      const report = await runStructuralExtractEval(fixture.diffs, configs)
      recordReport('fixture', fixture.name, report)
    } catch (error) {
      console.log(`error: ${(error as Error).message}`)
    }
  }

  console.log('')
  console.log(`Aggregate:`)
  console.log(`  scenarios:        ${scenarioTarget.length}`)
  console.log(`  fixtures:         ${fixtureTarget.length}`)
  console.log(`  input files:      ${aggregateInputFiles}`)
  console.log(`  baseline LLM:     ${aggregateBaselineCalls}`)
  console.log(`  enabled LLM:      ${aggregateEnabledCalls}`)
  console.log(`  LLM calls saved:  ${aggregateBaselineCalls - aggregateEnabledCalls}`)
  console.log(`  fast-path hits:   ${aggregateFastPathHits}`)
  console.log('')
  console.log(`Reports written to: ${outDir}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
