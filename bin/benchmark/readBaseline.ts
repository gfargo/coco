/**
 * Loads and validates `.bench/baseline.json`, split out from `benchmark.ts`
 * so it can be unit-tested without importing that module (which runs
 * `main()` as a load-time side effect).
 *
 * A missing file and a corrupt file are reported distinctly from "no
 * baseline row for this fixture" (handled in `evaluateCheck.ts`) — the
 * caller decides how to react. For `--check`, losing the baseline file
 * entirely (deleted, bad merge, truncated write) must not silently degrade
 * the gate to a no-op, so it needs to be distinguishable from "this is the
 * first-ever bench run and there's nothing to compare against yet".
 */

import * as fs from 'node:fs'

import { BenchResult } from './evaluateCheck'

export type BaselineReadResult =
  | { status: 'ok'; results: BenchResult[] }
  | { status: 'missing' }
  | { status: 'invalid'; reason: string }

export function readBaseline(baselinePath: string): BaselineReadResult {
  if (!fs.existsSync(baselinePath)) {
    return { status: 'missing' }
  }

  let raw: string
  try {
    raw = fs.readFileSync(baselinePath, 'utf8')
  } catch (error) {
    return { status: 'invalid', reason: `could not read file (${(error as Error).message})` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { status: 'invalid', reason: `invalid JSON (${(error as Error).message})` }
  }

  const results = (parsed as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) {
    return { status: 'invalid', reason: 'missing or non-array "results" field' }
  }

  return { status: 'ok', results: results as BenchResult[] }
}
