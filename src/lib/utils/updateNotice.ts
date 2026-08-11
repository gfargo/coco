/**
 * Stale-version notice (#OSS-1601). Because `dynamicModels.ts` pins model ids
 * that retire, a coco left un-upgraded can silently start 404-ing against a
 * provider. This module is the pure decision half — mirrors `usageConsent.ts`:
 * a cached "latest seen" version is compared against the running build and,
 * once per 24h on an interactive/non-CI/non-`--json`/non-`--quiet` run, a
 * one-line notice is printed. The IO half (cache read/write, the actual
 * registry fetch) lives in `updateCheck.ts`; keeping the decision pure makes
 * every combination of state exhaustively testable.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type UpdateNoticeEnv = {
  /** The version this running build reports (`BUILD_VERSION`). */
  currentVersion: string
  /** Most recently cached "latest on npm" version, if any check has ever completed. */
  latestKnownVersion: string | undefined
  /** ISO timestamp of the last completed registry check, if any. */
  lastCheckedAt: string | undefined
  /** `Date.now()`-equivalent, threaded in for deterministic tests. */
  now: number
  /** Whether this run is an interactive terminal session (TTY, not CI) — see `isConsentInteractive`. */
  interactive: boolean
  /** True when `--json` or `--quiet` was passed — the notice must never mix into machine-readable or silenced output. */
  suppressedByFlags: boolean
  /** `updateCheck.enabled` resolved from config (default true) and/or an env override. */
  enabled: boolean
}

export type UpdateNoticeDecision = {
  /** Kick off a background registry check (best-effort, fire-and-forget) to refresh the cache for next run. */
  shouldCheck: boolean
  /** Print `notice` to stderr this run. */
  shouldNotify: boolean
  /** One-line notice text, set only when `shouldNotify` is true. */
  notice: string | undefined
}

/** Parses a `major.minor.patch` prefix; non-numeric/missing parts read as 0. */
function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return [0, 0, 0]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** True when `latest` is strictly newer than `current` (numeric major.minor.patch compare). */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(latest)
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true
    if (b[i] < a[i]) return false
  }
  return false
}

export function updateNoticeText(currentVersion: string, latestVersion: string): string {
  return (
    `A newer coco is available: ${latestVersion} (running ${currentVersion}). ` +
    'Run `npm install -g git-coco@latest` to upgrade, or set `updateCheck.enabled=false` to silence this.'
  )
}

export function decideUpdateNotice(env: UpdateNoticeEnv): UpdateNoticeDecision {
  const disabled = !env.enabled || env.suppressedByFlags || !env.interactive
  if (disabled) {
    return { shouldCheck: false, shouldNotify: false, notice: undefined }
  }

  const isStale =
    env.lastCheckedAt === undefined || env.now - Date.parse(env.lastCheckedAt) >= ONE_DAY_MS

  const shouldNotify =
    env.latestKnownVersion !== undefined && isNewerVersion(env.currentVersion, env.latestKnownVersion)

  return {
    shouldCheck: isStale,
    shouldNotify,
    notice: shouldNotify ? updateNoticeText(env.currentVersion, env.latestKnownVersion as string) : undefined,
  }
}
