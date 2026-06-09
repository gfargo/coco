/**
 * First-run consent for the local usage ledger (#0.69). Recording is opt-OUT:
 * the first time a command runs with no `telemetry.usage` preference recorded
 * anywhere, coco enables recording on an interactive terminal (persisting and
 * announcing the choice once), but stays off in non-interactive / CI contexts
 * so piped and automated runs are never silently opted in. `COCO_USAGE_LOG`
 * overrides everything, and `coco init` owns its own opt-out prompt.
 *
 * The decision is a pure function so the matrix is exhaustively testable; the
 * command executor performs the IO (persist + notice) based on the result.
 */
export type UsageConsentEnv = {
  /** The command being run (yargs `argv._[0]`), e.g. 'commit'. */
  commandName: string
  /** Resolved `telemetry.usage` from merged config, or undefined if unset everywhere. */
  configPreference: boolean | undefined
  /** Raw `COCO_USAGE_LOG` value, if any. */
  envOverride: string | undefined
  /** Whether this run is an interactive terminal session (TTY, not CI). */
  interactive: boolean
}

export type UsageConsentDecision = {
  /** Preference to feed `setUsageConfigPreference`. */
  preference: boolean | undefined
  /** True on a first interactive run that just enabled recording — persist + notify. */
  enabledOnFirstRun: boolean
}

/** One-time notice shown when a first interactive run defaults recording on. */
export const USAGE_ENABLED_NOTICE =
  'coco now keeps a local record of AI usage stats (tokens + latency) to power `coco doctor --cost`. ' +
  'It stays on this machine and records no code. Opt out anytime with `coco init`, ' +
  'telemetry.usage=false, or COCO_USAGE_LOG=0.'

export function decideUsageConsent(env: UsageConsentEnv): UsageConsentDecision {
  // `COCO_USAGE_LOG` wins outright — nothing to decide or persist; the ledger
  // reads the env var directly.
  if (env.envOverride !== undefined && env.envOverride !== '') {
    return { preference: undefined, enabledOnFirstRun: false }
  }
  // A preference is already on record (config layer) — honor it as-is.
  if (env.configPreference !== undefined) {
    return { preference: env.configPreference, enabledOnFirstRun: false }
  }
  // No preference anywhere. `init` runs its own opt-out prompt — don't pre-empt.
  if (env.commandName === 'init') {
    return { preference: undefined, enabledOnFirstRun: false }
  }
  // First run. Default on for an interactive human (and persist + announce);
  // stay off and write nothing for non-interactive / CI so scripts and
  // pipelines are never opted in behind the user's back.
  if (env.interactive) {
    return { preference: true, enabledOnFirstRun: true }
  }
  return { preference: undefined, enabledOnFirstRun: false }
}

/** Interactive = both stdio ends are TTYs and we're not running under CI. */
export function isConsentInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI)
}
