import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { LlmCallMetadata } from './observability'

/**
 * Opt-in LLM usage ledger (#0.68). Records a compact line per LLM call so the
 * `coco doctor` cost report can aggregate tokens + latency by task / model
 * ACROSS runs — the in-memory telemetry in `observability.ts` only survives a
 * single command. Recording is OFF by default and gated on `COCO_USAGE_LOG`
 * (no usage data is written to disk unless the user opts in); reading is always
 * available so `coco doctor` can surface whatever has accumulated.
 */
export type UsageRecord = {
  /** Epoch milliseconds. */
  t: number
  command?: string
  task: string
  provider?: string
  model?: string
  promptTokens?: number
  elapsedMs?: number
}

export type UsageAggregate = {
  key: string
  calls: number
  promptTokens: number
  totalMs: number
  avgMs: number
}

function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return path.join(xdg, 'coco')
  return path.join(os.homedir(), '.cache', 'coco')
}

/**
 * Path to the ledger. `COCO_USAGE_LOG` may be a filesystem path (used verbatim)
 * or a boolean-ish toggle (`1` / `true`), in which case the default cache path
 * is used.
 */
export function getUsageLogPath(): string {
  const env = process.env.COCO_USAGE_LOG
  if (env && !isBooleanish(env)) {
    return env
  }
  return path.join(cacheDir(), 'usage.jsonl')
}

function isBooleanish(value: string): boolean {
  const v = value.toLowerCase()
  return v === '1' || v === '0' || v === 'true' || v === 'false'
}

/** True when usage recording is enabled (any truthy `COCO_USAGE_LOG`). */
export function isUsageLoggingEnabled(): boolean {
  const env = process.env.COCO_USAGE_LOG
  if (!env) return false
  const v = env.toLowerCase()
  return v !== '0' && v !== 'false'
}

/**
 * Append one usage record. No-op unless logging is enabled. Never throws into
 * the LLM call path — a ledger write failure must not break a command.
 */
export function recordUsage(metadata: LlmCallMetadata): void {
  if (!isUsageLoggingEnabled()) return

  const record: UsageRecord = {
    t: Date.now(),
    command: metadata.command,
    task: metadata.task,
    provider: metadata.provider,
    model: metadata.model,
    promptTokens: metadata.promptTokens,
    elapsedMs: metadata.elapsedMs,
  }

  try {
    const filePath = getUsageLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Best-effort telemetry — swallow write errors.
  }
}

/** Read + parse all usage records. Returns `[]` when the ledger is absent. */
export function readUsageRecords(filePath: string = getUsageLogPath()): UsageRecord[] {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const records: UsageRecord[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as UsageRecord
      if (parsed && typeof parsed.task === 'string') records.push(parsed)
    } catch {
      // Skip malformed lines rather than failing the whole read.
    }
  }
  return records
}

function aggregate(records: UsageRecord[], keyOf: (r: UsageRecord) => string): UsageAggregate[] {
  const byKey = new Map<string, { calls: number; promptTokens: number; totalMs: number }>()
  for (const r of records) {
    const key = keyOf(r) || 'unknown'
    const current = byKey.get(key) || { calls: 0, promptTokens: 0, totalMs: 0 }
    current.calls += 1
    current.promptTokens += r.promptTokens || 0
    current.totalMs += r.elapsedMs || 0
    byKey.set(key, current)
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      promptTokens: v.promptTokens,
      totalMs: v.totalMs,
      avgMs: v.calls > 0 ? Math.round(v.totalMs / v.calls) : 0,
    }))
    .sort((a, b) => b.promptTokens - a.promptTokens || b.calls - a.calls)
}

/** Aggregate usage by dynamic-model task label. */
export function summarizeUsageByTask(records: UsageRecord[]): UsageAggregate[] {
  return aggregate(records, (r) => r.task)
}

/** Aggregate usage by model id. */
export function summarizeUsageByModel(records: UsageRecord[]): UsageAggregate[] {
  return aggregate(records, (r) => r.model || 'unknown')
}

/** Delete the ledger file (best-effort). */
export function clearUsageLog(filePath: string = getUsageLogPath()): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // ignore
  }
}
