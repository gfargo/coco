import { resolveRepoIdentifier } from '../../git/repoIdentifier'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import {
  isUsageLoggingEnabled,
  setUsageConfigPreference,
  setUsageRepoTag,
} from '../../lib/langchain/utils/usageLedger'

/**
 * Arm the local metadata-only usage ledger for machine-facing transports.
 *
 * Unlike the normal command executor, this path never prompts, persists a
 * preference, or prints a notice. It only honors an existing telemetry.usage
 * preference and the COCO_USAGE_LOG override. Repository tagging is a
 * best-effort read and records only a readable owner/repo identifier.
 */
export async function armNonInteractiveUsageTelemetry<T extends object>(
  argv: T,
  repoRoot: string,
): Promise<void> {
  try {
    const config = loadConfig<Record<string, never>, T>(argv)
    setUsageConfigPreference(config.telemetry?.usage)
    setUsageRepoTag(
      isUsageLoggingEnabled()
        ? await resolveRepoIdentifier({ cwd: repoRoot })
        : undefined,
    )
  } catch {
    // Analytics setup must never interfere with an agent operation or server.
  }
}
