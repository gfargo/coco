import chalk from 'chalk'

import { createJsonStore } from '../../workstation/chrome/jsonStore'
import { BUILD_PACKAGE_NAME, BUILD_VERSION } from '../buildInfo'
import { Config } from '../config/types'
import { decideUpdateNotice } from './updateNotice'
import { isConsentInteractive } from './usageConsent'
import { Logger } from './logger'

/**
 * IO half of the stale-version notice (#OSS-1601) — cache persistence and the
 * npm registry fetch. `updateNotice.ts` holds the pure decision so the matrix
 * is exhaustively testable; this module wires it into a real cache + network
 * call, kept entirely best-effort so a broken cache or unreachable registry
 * never affects a command.
 */

const CACHE_SCHEMA_VERSION = 1

type UpdateCheckCache = {
  lastCheckedAt: string
  latestVersion: string
}

const store = createJsonStore<UpdateCheckCache>({
  subdir: 'update',
  basename: 'latest.json',
  version: CACHE_SCHEMA_VERSION,
  validate: (raw) => {
    if (!raw || typeof raw !== 'object') return undefined
    const source = raw as Partial<UpdateCheckCache>
    if (typeof source.lastCheckedAt !== 'string' || typeof source.latestVersion !== 'string') {
      return undefined
    }
    return { lastCheckedAt: source.lastCheckedAt, latestVersion: source.latestVersion }
  },
})

/**
 * Refreshes the cache for *next* run. Deliberately not awaited by callers —
 * this must never sit on a command's critical path — and every failure mode
 * (network, non-2xx, malformed JSON) is swallowed silently.
 */
function refreshCacheInBackground(): void {
  try {
    fetch(`https://registry.npmjs.org/${BUILD_PACKAGE_NAME}/latest`)
      .then((res) => (res.ok ? (res.json() as Promise<{ version?: string }>) : null))
      .then((data) => {
        if (!data?.version) return
        store.write({ lastCheckedAt: new Date().toISOString(), latestVersion: data.version })
      })
      .catch(() => {
        // Best-effort — a failed check just retries once the cache goes stale again.
      })
  } catch {
    // fetch() throwing synchronously (unlikely) must not surface either.
  }
}

export type MaybeNotifyUpdateArgv = {
  json?: boolean
  quiet?: boolean
}

/**
 * Prints a one-line "newer coco available" notice to stderr from the
 * *cached* latest-seen version, and — at most once per 24h — kicks off a
 * background registry check to refresh that cache for next time. Never
 * awaited on the command's critical path, never runs under `--json`,
 * `--quiet`, CI, or a non-interactive session, and is opt-out via
 * `updateCheck.enabled: false`.
 */
export async function maybeNotifyUpdate(
  argv: MaybeNotifyUpdateArgv,
  options: Pick<Config, 'updateCheck'>,
  logger: Logger
): Promise<void> {
  try {
    const cached = store.read()
    const decision = decideUpdateNotice({
      currentVersion: BUILD_VERSION,
      latestKnownVersion: cached?.latestVersion,
      lastCheckedAt: cached?.lastCheckedAt,
      now: Date.now(),
      interactive: isConsentInteractive(),
      suppressedByFlags: argv.json === true || argv.quiet === true,
      enabled: options.updateCheck?.enabled !== false,
    })

    if (decision.shouldNotify && decision.notice) {
      logger.error(chalk.dim(decision.notice))
    }

    if (decision.shouldCheck) {
      refreshCacheInBackground()
    }
  } catch {
    // The update check must never interfere with the command.
  }
}
