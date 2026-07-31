import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LlmCallMetadata } from './observability'
import { getCocoCacheDir } from '../../utils/cocoPaths'

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
  /** Invocation surface. Records written before this field existed are normal CLI calls. */
  surface?: LlmCallMetadata['surface']
  provider?: string
  model?: string
  promptTokens?: number
  /** Output/completion tokens, when the provider's usage metadata reports them. */
  completionTokens?: number
  /** Input tokens served from the provider's prompt cache, when reported. */
  cachedInputTokens?: number
  /** The provider's own reported total input-token count, when present — see `LlmCallMetadata.inputTokens`. */
  inputTokens?: number
  elapsedMs?: number
  /** Readable `owner/repo` (or directory name) the call ran against. */
  repo?: string
  /**
   * Diff-summary cache outcome (#1958): `true` on a hit, `false` on a
   * miss. Absent when the cache wasn't consulted for this call (disabled,
   * or not a cache-eligible task) — records without this field predate
   * the feature or are non-cache tasks, and are excluded from hit-rate
   * aggregation rather than counted as misses.
   */
  cacheHit?: boolean
}

export type UsageAggregate = {
  key: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedInputTokens: number
  /** Sum of the provider-reported `inputTokens`, when any records had it. */
  inputTokens: number
  totalMs: number
  avgMs: number
  /** Count of calls where the diff-summary cache was consulted and hit. */
  cacheHits: number
  /** Count of calls where the diff-summary cache was consulted (hit or miss). */
  cacheLookups: number
}

/**
 * Keep the ledger bounded. Once the file crosses `MAX_LEDGER_BYTES`, it is
 * rewritten with only the most recent `TRIM_TO_RECORDS` lines. The size check
 * is a cheap `stat`; the rewrite happens rarely (only when the cap is crossed),
 * and ~20k records sits comfortably under the 5 MB ceiling.
 */
const MAX_LEDGER_BYTES = 5 * 1024 * 1024
const TRIM_TO_RECORDS = 20_000

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
  return path.join(getCocoCacheDir(), 'usage.jsonl')
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
    surface: metadata.surface ?? 'cli',
    provider: metadata.provider,
    model: metadata.model,
    promptTokens: metadata.promptTokens,
    completionTokens: metadata.completionTokens,
    cachedInputTokens: metadata.cachedInputTokens,
    inputTokens: metadata.inputTokens,
    elapsedMs: metadata.elapsedMs,
    ...(repoTag ? { repo: repoTag } : {}),
    ...(metadata.cacheHit !== undefined ? { cacheHit: metadata.cacheHit } : {}),
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
  const byKey = new Map<
    string,
    {
      calls: number
      promptTokens: number
      completionTokens: number
      cachedInputTokens: number
      inputTokens: number
      totalMs: number
      cacheHits: number
      cacheLookups: number
    }
  >()
  for (const r of records) {
    const key = keyOf(r) || 'unknown'
    const current = byKey.get(key) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 0,
      totalMs: 0,
      cacheHits: 0,
      cacheLookups: 0,
    }
    if (r.cacheHit !== true) {
      current.calls += 1
      current.promptTokens += r.promptTokens || 0
      current.completionTokens += r.completionTokens || 0
      current.cachedInputTokens += r.cachedInputTokens || 0
      current.inputTokens += r.inputTokens || 0
      current.totalMs += r.elapsedMs || 0
    }
    if (typeof r.cacheHit === 'boolean') {
      current.cacheLookups += 1
      if (r.cacheHit) current.cacheHits += 1
    }
    byKey.set(key, current)
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      promptTokens: v.promptTokens,
      completionTokens: v.completionTokens,
      cachedInputTokens: v.cachedInputTokens,
      inputTokens: v.inputTokens,
      totalMs: v.totalMs,
      avgMs: v.calls > 0 ? Math.round(v.totalMs / v.calls) : 0,
      cacheHits: v.cacheHits,
      cacheLookups: v.cacheLookups,
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

/** Aggregate usage by invocation surface. Legacy records predate agent transports and are CLI calls. */
export function summarizeUsageBySurface(records: UsageRecord[]): UsageAggregate[] {
  return aggregate(records, (r) => r.surface || 'cli')
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
