import { resolveRepoIdentifier } from '../../git/repoIdentifier'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import {
  isUsageLoggingEnabled,
  setUsageConfigPreference,
  setUsageRepoTag,
} from '../../lib/langchain/utils/usageLedger'

/**
 * Arm the local metadata-only usage ledger's recording preference. This half
 * is repository-independent: it only reads `telemetry.usage` from config
 * (resolved from `argv`/cwd) and the `COCO_USAGE_LOG` override, so it is safe
 * to call before any repository is known.
 *
 * Unlike the normal command executor, this path never prompts, persists a
 * preference, or prints a notice.
 */
export function armNonInteractiveUsagePreference<T extends object>(argv: T): void {
  try {
    const config = loadConfig<Record<string, never>, T>(argv)
    setUsageConfigPreference(config.telemetry?.usage)
  } catch {
    // Analytics setup must never interfere with an agent operation or server.
  }
}

/**
 * Stamp the usage ledger with the repository the current/next calls are
 * running against. Best-effort read and records only a readable owner/repo
 * identifier; no-op when logging is disabled.
 */
export async function applyUsageRepoTag(repoRoot: string): Promise<void> {
  try {
    setUsageRepoTag(
      isUsageLoggingEnabled()
        ? await resolveRepoIdentifier({ cwd: repoRoot })
        : undefined,
    )
  } catch {
    // Analytics setup must never interfere with an agent operation or server.
  }
}

/**
 * Arm the local metadata-only usage ledger for machine-facing transports
 * that know their repository root at startup. Combines preference arming
 * and repo tagging into one call.
 */
export async function armNonInteractiveUsageTelemetry<T extends object>(
  argv: T,
  repoRoot: string,
): Promise<void> {
  armNonInteractiveUsagePreference(argv)
  await applyUsageRepoTag(repoRoot)
}
