import * as fs from 'node:fs'
import * as path from 'node:path'

import { Logger } from '../../utils/logger'
import { TokenCounter } from '../../utils/tokenizer'

export type LlmCallMetadata = {
  task: string
  command?: string
  provider?: string
  model?: string
  retryAttempt?: number
  parserType?: string
  variableKeys?: string[]
  promptTokens?: number
  elapsedMs?: number
  inputDocuments?: number
  inputChunks?: number
}

/**
 * Bench-mode call record (#845). Captured for every LLM call when
 * `COCO_BENCH=1` (or a path) is set, then flushed to disk by
 * `flushLlmBenchRun` at the end of the command. The structure stays
 * narrow on purpose — fields the runner actually compares before /
 * after, nothing more — so different runs with different model /
 * provider mixes can still diff against the baseline cleanly.
 */
type LlmBenchCall = {
  task: string
  command?: string
  provider?: string
  model?: string
  promptTokens?: number
  elapsedMs?: number
  inputDocuments?: number
  inputChunks?: number
}

const benchCalls: LlmBenchCall[] = []

type LlmTelemetrySummary = {
  calls: number
  promptTokens: number
  elapsedMs: number
  inputDocuments: number
  inputChunks: number
  tasks: Set<string>
  models: Set<string>
}

const telemetryByCommand = new Map<string, LlmTelemetrySummary>()

export function estimatePromptTokens(
  tokenizer: TokenCounter | undefined,
  renderedPrompt: string
): number | undefined {
  if (!tokenizer) return undefined

  try {
    return tokenizer(renderedPrompt)
  } catch {
    return undefined
  }
}

function isBenchModeActive(): boolean {
  return Boolean(process.env.COCO_BENCH && process.env.COCO_BENCH !== '0')
}

function recordBenchCall(metadata: LlmCallMetadata): void {
  if (!isBenchModeActive()) return
  benchCalls.push({
    task: metadata.task,
    command: metadata.command,
    provider: metadata.provider,
    model: metadata.model,
    promptTokens: metadata.promptTokens,
    elapsedMs: metadata.elapsedMs,
    inputDocuments: metadata.inputDocuments,
    inputChunks: metadata.inputChunks,
  })
}

export function logLlmCall(logger: Logger | undefined, metadata: LlmCallMetadata): void {
  if (!logger) return

  recordLlmTelemetry(metadata)
  recordBenchCall(metadata)

  const fields = [
    `task=${metadata.task}`,
    metadata.command ? `command=${metadata.command}` : undefined,
    metadata.provider ? `provider=${metadata.provider}` : undefined,
    metadata.model ? `model=${metadata.model}` : undefined,
    metadata.retryAttempt ? `retryAttempt=${metadata.retryAttempt}` : undefined,
    metadata.promptTokens !== undefined ? `promptTokens=${metadata.promptTokens}` : undefined,
    metadata.elapsedMs !== undefined ? `elapsedMs=${metadata.elapsedMs}` : undefined,
    metadata.inputDocuments !== undefined ? `inputDocuments=${metadata.inputDocuments}` : undefined,
    metadata.inputChunks !== undefined ? `inputChunks=${metadata.inputChunks}` : undefined,
    metadata.parserType ? `parser=${metadata.parserType}` : undefined,
    metadata.variableKeys?.length ? `variableKeys=${metadata.variableKeys.join(',')}` : undefined,
  ].filter(Boolean)

  logger.verbose(`[llm] ${fields.join(' ')}`, { color: 'cyan' })
}

function recordLlmTelemetry(metadata: LlmCallMetadata): void {
  const command = metadata.command || 'unknown'
  const current = telemetryByCommand.get(command) || {
    calls: 0,
    promptTokens: 0,
    elapsedMs: 0,
    inputDocuments: 0,
    inputChunks: 0,
    tasks: new Set<string>(),
    models: new Set<string>(),
  }

  current.calls += 1
  current.promptTokens += metadata.promptTokens || 0
  current.elapsedMs += metadata.elapsedMs || 0
  current.inputDocuments += metadata.inputDocuments || 0
  current.inputChunks += metadata.inputChunks || 0
  current.tasks.add(metadata.task)

  if (metadata.model) {
    current.models.add(metadata.model)
  }

  telemetryByCommand.set(command, current)
}

export function logLlmTelemetrySummary(logger: Logger | undefined, command: string): string | undefined {
  if (!logger) return undefined

  const summary = telemetryByCommand.get(command)
  if (!summary || summary.calls === 0) return undefined

  const fields = [
    `command=${command}`,
    `calls=${summary.calls}`,
    summary.promptTokens > 0 ? `promptTokens=${summary.promptTokens}` : undefined,
    summary.elapsedMs > 0 ? `elapsedMs=${summary.elapsedMs}` : undefined,
    summary.inputDocuments > 0 ? `inputDocuments=${summary.inputDocuments}` : undefined,
    summary.inputChunks > 0 ? `inputChunks=${summary.inputChunks}` : undefined,
    summary.tasks.size > 0 ? `tasks=${[...summary.tasks].join(',')}` : undefined,
    summary.models.size > 0 ? `models=${[...summary.models].join(',')}` : undefined,
  ].filter(Boolean)
  const message = `[llm:summary] ${fields.join(' ')}`

  logger.verbose(message, { color: 'cyan' })
  telemetryByCommand.delete(command)
  return message
}

export function resetLlmTelemetry(): void {
  telemetryByCommand.clear()
  benchCalls.length = 0
}

export type LlmBenchRunStage = {
  name: string
  elapsedMs: number
}

export type LlmBenchRunRecord = {
  command?: string
  totalElapsedMs?: number
  stages?: LlmBenchRunStage[]
  callCount: number
  totalLlmElapsedMs: number
  totalPromptTokens: number
  calls: LlmBenchCall[]
}

/**
 * Build the in-memory bench run record from accumulated calls.
 * Pure (no I/O) so callers can inspect or assert the contents without
 * touching disk — useful in tests + the in-process benchmark runner.
 */
export function buildLlmBenchRun(
  options: {
    command?: string
    totalElapsedMs?: number
    stages?: LlmBenchRunStage[]
  } = {}
): LlmBenchRunRecord {
  const calls = benchCalls.slice()
  return {
    command: options.command,
    totalElapsedMs: options.totalElapsedMs,
    stages: options.stages,
    callCount: calls.length,
    totalLlmElapsedMs: calls.reduce((sum, call) => sum + (call.elapsedMs || 0), 0),
    totalPromptTokens: calls.reduce((sum, call) => sum + (call.promptTokens || 0), 0),
    calls,
  }
}

/**
 * Persist the current bench run to a JSON file. No-op when bench
 * mode is inactive (so production runs don't pay for disk I/O).
 *
 * The file path comes from `COCO_BENCH_FILE` if set, otherwise
 * defaults to `<cwd>/.coco-bench.json`. Each call appends to the
 * `runs` array of the file (creates the file if missing) so a single
 * benchmark session that triggers multiple commands ends up with one
 * file containing the full sequence.
 *
 * Best-effort: write failures are swallowed silently. The bench
 * runner reports back the failure mode via the return value.
 */
export function flushLlmBenchRun(
  options: {
    command?: string
    totalElapsedMs?: number
    stages?: LlmBenchRunStage[]
  } = {}
): { ok: boolean; filePath?: string; error?: string } {
  if (!isBenchModeActive()) {
    return { ok: false, error: 'COCO_BENCH not set' }
  }

  const record = buildLlmBenchRun(options)
  const filePath = path.resolve(process.env.COCO_BENCH_FILE || path.join(process.cwd(), '.coco-bench.json'))

  try {
    let existing: { runs: LlmBenchRunRecord[] } = { runs: [] }
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.runs)) {
          existing = parsed
        }
      } catch {
        // Corrupt or pre-existing non-bench file: overwrite with a
        // fresh structure. Bench mode is opt-in; collisions here are
        // a developer-only concern.
      }
    }
    existing.runs.push(record)
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))
    benchCalls.length = 0
    return { ok: true, filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
