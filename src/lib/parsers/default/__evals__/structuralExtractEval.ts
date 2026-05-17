/**
 * Structural-extract A/B eval harness (#934).
 *
 * Runs `summarizeLargeFiles` against a fixed set of `FileDiff[]` twice —
 * once with `fastPath.languageAware.enabled: false` (the LLM baseline),
 * once with it enabled — and reports per-file outcomes plus aggregate
 * metrics: how many LLM calls were saved, what percentage of files hit
 * the fast path, and the resulting summary text in each config.
 *
 * Mocks the LLM call. Real-LLM evals are slow and non-deterministic;
 * the goal here is mechanical regression detection (does a parser
 * change reduce fast-path hits? does an extractor change increase
 * them?), which doesn't need real model output. A separate "live"
 * harness mode can be layered on top once it's worth the cost.
 *
 * Inputs come from the scenario library (`@gfargo/git-scenarios`)
 * via `scenarioInputs.ts` — each scenario's commits produce a
 * deterministic set of file diffs, so eval runs are byte-identical
 * across machines.
 */

import type { FileDiff } from '../../../types'
import { summarizeLargeFiles } from '../utils/summarizeLargeFiles'

export type StructuralLanguageId = 'ts' | 'js' | 'py' | 'rs' | 'go'

/** Config for a single eval run. */
export type EvalRunConfig = {
  /** Short label for the run, e.g. "baseline" / "languageAware-on". */
  label: string
  /** Forwarded to `summarizeLargeFiles`. */
  fastPath?: {
    markdown?: boolean
    languageAware?: {
      enabled?: boolean
      languages?: StructuralLanguageId[]
    }
  }
  /**
   * Override the summarization thresholds for this run. The defaults
   * are tuned for the eval — lower than the production parser defaults
   * so the harness actually exercises the summarization path on the
   * compact files scenarios produce. Production runs use much higher
   * thresholds (~25% of `maxTokens`), so eval results are NOT a
   * faithful proxy for production behavior on a single file; they
   * measure the *relative* fast-path vs. LLM split when summarization
   * fires.
   */
  maxFileTokens?: number
  minTokensForSummary?: number
}

const DEFAULT_EVAL_MAX_FILE_TOKENS = 20
const DEFAULT_EVAL_MIN_TOKENS_FOR_SUMMARY = 10

/** Per-file outcome inside a single run. */
export type EvalFileOutcome = {
  file: string
  /** Token count before any rewrite. Mirrors the input `FileDiff.tokenCount`. */
  inputTokens: number
  /** Token count after rewrite (whether by fast path or LLM). */
  outputTokens: number
  /**
   * What rewrote the file's diff. `'unchanged'` when the file fell below
   * the size threshold; the other values match the explicit branches in
   * `summarizeFileDiff`. We infer the branch from the file's output
   * shape (LLM produces a fixed-shape mock string; templated paths
   * produce recognizable substrings). Imperfect but deterministic.
   */
  outcome: 'unchanged' | 'trivial' | 'markdown' | 'languageAware' | 'llm'
}

export type EvalRunResult = {
  label: string
  /** Total LLM calls fired during this run. */
  llmCalls: number
  /** Sum of token counts across all output files. */
  totalOutputTokens: number
  /** Sum of token counts across all input files (constant across runs). */
  totalInputTokens: number
  files: EvalFileOutcome[]
}

export type EvalReport = {
  /** Number of input diffs evaluated. */
  inputFileCount: number
  /** One entry per `EvalRunConfig` supplied. Order matches the input. */
  runs: EvalRunResult[]
  /**
   * Pairwise delta from the first (baseline) run to each subsequent
   * run. Empty when only one run was supplied.
   */
  deltas: Array<{
    against: string
    label: string
    llmCallsSaved: number
    tokenReduction: number
    fastPathHitCount: number
  }>
}

/**
 * Mock-mode LLM stand-in. Produces a fixed-shape string we can
 * recognize when classifying outcomes, while keeping the harness
 * deterministic + offline. The shape carries the input file count so
 * tests can assert against it without needing to know exact tokens.
 */
const MOCK_LLM_PREFIX = '<<llm-mock>> summarized'

function classifyOutcome(input: FileDiff, output: FileDiff): EvalFileOutcome['outcome'] {
  if (output.diff === input.diff && output.tokenCount === input.tokenCount) return 'unchanged'
  if (output.diff.startsWith(MOCK_LLM_PREFIX)) return 'llm'
  if (output.diff.startsWith('Updated markdown ')) return 'markdown'
  if (output.diff.match(/^Updated (TypeScript|JavaScript|Python|Rust|Go) /)) return 'languageAware'
  // The trivial-shape path emits short templated strings like "Added
  // X. Removed Y." / "Renamed A -> B." / "Binary file changed."
  // No exact prefix to assert on, so this branch is the catch-all for
  // "diff changed but no recognized prefix" — almost always the
  // trivial-shape path.
  return 'trivial'
}

/**
 * Run a single configuration against the supplied diffs and return a
 * structured result.
 */
async function runOne(
  diffs: FileDiff[],
  config: EvalRunConfig,
): Promise<EvalRunResult> {
  // Dependency-injection mock: `summarizeLargeFiles` forwards the
  // supplied `chain` + `textSplitter` to `summarize()`, which calls
  // `chain.invoke()` per LLM call. Providing fakes here means we
  // count + short-circuit the LLM without patching the module — works
  // in CLI runs (no jest globals available) and tests alike.
  let llmCalls = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    invoke: async (input: { input_documents: Array<{ pageContent: string }> }) => {
      llmCalls += 1
      const totalLength = (input.input_documents || []).reduce(
        (sum: number, doc) => sum + (doc.pageContent?.length || 0),
        0,
      )
      const text = `${MOCK_LLM_PREFIX} ${(input.input_documents || []).length} document(s), ${totalLength} chars`
      return { text }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textSplitter: any = {
    splitDocuments: async (docs: unknown) => docs,
  }

  const result = await summarizeLargeFiles(diffs, {
    maxFileTokens: config.maxFileTokens ?? DEFAULT_EVAL_MAX_FILE_TOKENS,
    minTokensForSummary: config.minTokensForSummary ?? DEFAULT_EVAL_MIN_TOKENS_FOR_SUMMARY,
    maxConcurrent: 4,
    fastPath: config.fastPath,
    tokenizer: (text) => Math.ceil(text.length / 4),
    logger: {
      verbose: () => undefined,
      log: () => undefined,
      startSpinner: () => undefined,
      stopSpinner: () => undefined,
      startTimer: () => undefined,
      stopTimer: () => undefined,
    } as never,
    chain,
    textSplitter,
  })

  const files: EvalFileOutcome[] = diffs.map((input, index) => {
    const output = result[index] || input
    return {
      file: input.file,
      inputTokens: input.tokenCount,
      outputTokens: output.tokenCount,
      outcome: classifyOutcome(input, output),
    }
  })

  return {
    label: config.label,
    llmCalls,
    totalInputTokens: diffs.reduce((sum, d) => sum + d.tokenCount, 0),
    totalOutputTokens: files.reduce((sum, f) => sum + f.outputTokens, 0),
    files,
  }
}

/**
 * Run all configs against the same input set and compute pairwise
 * deltas vs the first run. The harness assumes the first run is the
 * baseline you want to compare against; pass it first.
 */
export async function runStructuralExtractEval(
  diffs: FileDiff[],
  configs: EvalRunConfig[],
): Promise<EvalReport> {
  if (configs.length === 0) {
    throw new Error('runStructuralExtractEval requires at least one config')
  }

  const runs: EvalRunResult[] = []
  for (const config of configs) {
    runs.push(await runOne(diffs, config))
  }

  const baseline = runs[0]
  const deltas = runs.slice(1).map((run) => {
    const fastPathHits = run.files.filter((f) =>
      f.outcome === 'languageAware' || f.outcome === 'markdown'
    ).length
    return {
      against: baseline.label,
      label: run.label,
      llmCallsSaved: baseline.llmCalls - run.llmCalls,
      tokenReduction: baseline.totalOutputTokens - run.totalOutputTokens,
      fastPathHitCount: fastPathHits,
    }
  })

  return {
    inputFileCount: diffs.length,
    runs,
    deltas,
  }
}

/**
 * Render an `EvalReport` as a human-readable Markdown summary. Suitable
 * for both CLI stdout and a Markdown file written to disk for PR
 * review.
 */
export function renderEvalReportMarkdown(report: EvalReport, title: string): string {
  const lines: string[] = []
  lines.push(`# ${title}`, '')
  lines.push(`Input files: ${report.inputFileCount}`, '')

  lines.push('## Per-run totals', '')
  lines.push('| Label | LLM calls | Input tokens | Output tokens |')
  lines.push('|---|---:|---:|---:|')
  for (const run of report.runs) {
    lines.push(
      `| ${run.label} | ${run.llmCalls} | ${run.totalInputTokens} | ${run.totalOutputTokens} |`,
    )
  }
  lines.push('')

  if (report.deltas.length > 0) {
    lines.push('## Deltas vs baseline', '')
    lines.push('| Label | LLM calls saved | Token reduction | Fast-path hits |')
    lines.push('|---|---:|---:|---:|')
    for (const delta of report.deltas) {
      lines.push(
        `| ${delta.label} | ${delta.llmCallsSaved} | ${delta.tokenReduction} | ${delta.fastPathHitCount} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
