/**
 * Pure comparison/gating logic for `bin/benchmark.ts --check`, split out
 * so it can be unit-tested without importing `benchmark.ts` itself (that
 * module runs `main()` as a load-time side effect).
 */

export type BenchResult = {
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

export type CheckTolerances = {
  /** llmCalls is fully deterministic; any increase past this is a hard failure. */
  maxLlmCallsIncrease: number
  /** durationMs is real wall-clock and varies by runner; only warn past this % drift... */
  durationWarnPct: number
  /** ...and only once the absolute drift clears this floor (tiny fixtures have ~0ms baselines). */
  durationFloorMs: number
}

export const DEFAULT_CHECK_TOLERANCES: CheckTolerances = {
  maxLlmCallsIncrease: 0,
  durationWarnPct: 25,
  durationFloorMs: 200,
}

export type CheckStatus = 'ok' | 'regression' | 'warning'

export type CheckEntry = {
  fixture: string
  status: CheckStatus
  message: string
  llmCalls: number
  baselineLlmCalls?: number
  durationMs: number
  baselineDurationMs?: number
}

/**
 * Baseline rows are captured with `--repeat`, so every fixture has both a
 * `cold` and a `warm` row. A `--check` run always measures cold (cache
 * cleared beforehand), so it must compare against the baseline's cold row —
 * matching on fixture name alone would non-deterministically pick warm rows
 * (near-zero calls/duration) and silently no-op the gate.
 */
function findBaselineRow(baseline: BenchResult[] | undefined, fixture: string): BenchResult | undefined {
  if (!baseline) return undefined
  return (
    baseline.find((entry) => entry.fixture === fixture && entry.pass === 'cold') ??
    baseline.find((entry) => entry.fixture === fixture && !entry.pass)
  )
}

export function evaluateCheck(
  results: BenchResult[],
  baseline: BenchResult[] | undefined,
  tolerances: CheckTolerances = DEFAULT_CHECK_TOLERANCES
): { ok: boolean; entries: CheckEntry[] } {
  const entries: CheckEntry[] = results.map((result) => {
    const prior = findBaselineRow(baseline, result.fixture)
    if (!prior) {
      return {
        fixture: result.fixture,
        status: 'warning',
        message: 'no baseline row for this fixture — skipping comparison',
        llmCalls: result.llmCalls,
        durationMs: result.durationMs,
      }
    }

    const llmCallsDelta = result.llmCalls - prior.llmCalls
    if (llmCallsDelta > tolerances.maxLlmCallsIncrease) {
      return {
        fixture: result.fixture,
        status: 'regression',
        message: `llmCalls regressed ${prior.llmCalls} -> ${result.llmCalls} (+${llmCallsDelta})`,
        llmCalls: result.llmCalls,
        baselineLlmCalls: prior.llmCalls,
        durationMs: result.durationMs,
        baselineDurationMs: prior.durationMs,
      }
    }

    const durationDelta = result.durationMs - prior.durationMs
    const durationPct =
      prior.durationMs === 0 ? (durationDelta > 0 ? Infinity : 0) : (durationDelta / prior.durationMs) * 100
    if (durationDelta > tolerances.durationFloorMs && durationPct > tolerances.durationWarnPct) {
      return {
        fixture: result.fixture,
        status: 'warning',
        message: `durationMs drifted ${prior.durationMs}ms -> ${result.durationMs}ms (+${durationDelta}ms, ${durationPct.toFixed(1)}%)`,
        llmCalls: result.llmCalls,
        baselineLlmCalls: prior.llmCalls,
        durationMs: result.durationMs,
        baselineDurationMs: prior.durationMs,
      }
    }

    return {
      fixture: result.fixture,
      status: 'ok',
      message: 'within tolerance',
      llmCalls: result.llmCalls,
      baselineLlmCalls: prior.llmCalls,
      durationMs: result.durationMs,
      baselineDurationMs: prior.durationMs,
    }
  })

  const ok = entries.every((entry) => entry.status !== 'regression')
  return { ok, entries }
}
