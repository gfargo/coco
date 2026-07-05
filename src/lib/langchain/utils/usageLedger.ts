import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { LlmCallMetadata } from './observability'

/**
 * Local LLM usage ledger. Records a compact line per LLM call so the
 * `coco doctor --cost` report can aggregate tokens + latency by task / model /
 * repo ACROSS runs — the in-memory telemetry in `observability.ts` only
 * survives a single command.
 *
 * Recording is gated two ways (#0.69): the `COCO_USAGE_LOG` environment
 * variable wins outright (a path / `1` / `true` forces it on, `0` / `false`
 * forces it off), and when that env var is unset recording follows the
 * `telemetry.usage` config preference resolved once per run by the command
 * executor. The ledger holds metadata only — task, model, prompt-token
 * estimate, latency, repo identifier — never prompt, diff, or code content,
 * and it never leaves the machine. Reading is always available so `coco
 * doctor` can surface whatever has accumulated.
 */
export type UsageRecord = {
  /** Epoch milliseconds. */
  t: number
  command?: string
  task: string
  provider?: string
  model?: string
  promptTokens?: number
  /** Output/completion tokens, when the provider's usage metadata reports them. */
  completionTokens?: number
  elapsedMs?: number
  /** Readable `owner/repo` (or directory name) the call ran against. */
  repo?: string
}

export type UsageAggregate = {
  key: string
  calls: number
  promptTokens: number
  completionTokens: number
  totalMs: number
  avgMs: number
}

/**
 * Keep the ledger bounded. Once the file crosses `MAX_LEDGER_BYTES`, it is
 * rewritten with only the most recent `TRIM_TO_RECORDS` lines. The size check
 * is a cheap `stat`; the rewrite happens rarely (only when the cap is crossed),
 * and ~20k records sits comfortably under the 5 MB ceiling.
 */
const MAX_LEDGER_BYTES = 5 * 1024 * 1024
const TRIM_TO_RECORDS = 20_000

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

/**
 * Config-resolved recording preference (`telemetry.usage`), set once per run by
 * the command executor. `COCO_USAGE_LOG` still overrides this either way; when
 * the env var is unset, this is what decides whether recording is on.
 */
let configPreference: boolean | undefined

/** Repo identifier stamped on each record, set once per run by the executor. */
let repoTag: string | undefined

/**
 * Set the config-resolved recording preference for this process. Called by the
 * command executor after it resolves `telemetry.usage` (and any first-run
 * consent). `undefined` leaves recording gated on `COCO_USAGE_LOG` alone.
 */
export function setUsageConfigPreference(preference: boolean | undefined): void {
  configPreference = preference
}

/** Stamp each subsequent record with the current repo identifier. */
export function setUsageRepoTag(repo: string | undefined): void {
  repoTag = repo
}

/** Reset module-level recording state. Tests use this between cases. */
export function resetUsageLedgerState(): void {
  configPreference = undefined
  repoTag = undefined
}

/**
 * True when usage recording is enabled. `COCO_USAGE_LOG` wins both ways — a
 * path / `1` / `true` forces it on, `0` / `false` forces it off — and when the
 * env var is unset recording follows the config preference (`telemetry.usage`).
 */
export function isUsageLoggingEnabled(): boolean {
  const env = process.env.COCO_USAGE_LOG
  if (env !== undefined && env !== '') {
    const v = env.toLowerCase()
    return v !== '0' && v !== 'false'
  }
  return configPreference === true
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
    completionTokens: metadata.completionTokens,
    elapsedMs: metadata.elapsedMs,
    ...(repoTag ? { repo: repoTag } : {}),
  }

  try {
    const filePath = getUsageLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
    rotateLedgerIfNeeded(filePath)
  } catch {
    // Best-effort telemetry — swallow write errors.
  }
}

/**
 * Trim the ledger to its most recent records once it grows past the byte cap.
 * Best-effort: a failed rotation just leaves the ledger oversized for now.
 */
function rotateLedgerIfNeeded(filePath: string): void {
  try {
    if (fs.statSync(filePath).size <= MAX_LEDGER_BYTES) return
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
    if (lines.length <= TRIM_TO_RECORDS) return
    const kept = lines.slice(-TRIM_TO_RECORDS)
    fs.writeFileSync(filePath, `${kept.join('\n')}\n`, 'utf8')
  } catch {
    // ignore
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
  const byKey = new Map<string, { calls: number; promptTokens: number; completionTokens: number; totalMs: number }>()
  for (const r of records) {
    const key = keyOf(r) || 'unknown'
    const current = byKey.get(key) || { calls: 0, promptTokens: 0, completionTokens: 0, totalMs: 0 }
    current.calls += 1
    current.promptTokens += r.promptTokens || 0
    current.completionTokens += r.completionTokens || 0
    current.totalMs += r.elapsedMs || 0
    byKey.set(key, current)
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      promptTokens: v.promptTokens,
      completionTokens: v.completionTokens,
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

/** Aggregate usage by repo identifier. */
export function summarizeUsageByRepo(records: UsageRecord[]): UsageAggregate[] {
  return aggregate(records, (r) => r.repo || 'unknown')
}

/** Delete the ledger file (best-effort). */
export function clearUsageLog(filePath: string = getUsageLogPath()): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // ignore
  }
}
