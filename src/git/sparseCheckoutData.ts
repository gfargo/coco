import { existsSync, readFileSync } from 'fs'
import { SimpleGit } from 'simple-git'

/**
 * Sparse-checkout detection for the TUI (OSS-2056).
 *
 * A partial (sparse) checkout omits paths from the working tree on
 * purpose — without a signal in the UI, those omissions read as lost
 * or deleted files. This module gives the workstation chrome a
 * best-effort status so it can flag the state instead.
 *
 * `enabled` requires both `core.sparseCheckout` config true AND the
 * `info/sparse-checkout` pattern file present, guarding against a repo
 * where the config was left set but the pattern file was removed
 * (e.g. `git sparse-checkout disable` variants that don't reset config).
 */

export type SparseCheckoutStatus = {
  /** True when sparse-checkout is configured AND the pattern file exists. */
  enabled: boolean
  /** True when `core.sparseCheckoutCone` is set (cone-mode patterns). */
  cone: boolean
  /** Count of non-blank, non-comment lines in the pattern file. */
  patternCount: number
}

const EMPTY_STATUS: SparseCheckoutStatus = { enabled: false, cone: false, patternCount: 0 }

async function readBoolConfig(git: SimpleGit, key: string): Promise<boolean> {
  try {
    return (await git.raw(['config', '--get', key])).trim() === 'true'
  } catch {
    // git config --get exits non-zero for an unset key.
    return false
  }
}

/**
 * Load the live sparse-checkout status. Best-effort — any git failure
 * (not a repo, config read error, etc.) falls through to the empty
 * status sentinel rather than throwing, so callers can fold this into
 * a `Promise.all` without a bespoke catch.
 */
export async function getSparseCheckoutStatus(git: SimpleGit): Promise<SparseCheckoutStatus> {
  try {
    const sparseConfig = await readBoolConfig(git, 'core.sparseCheckout')
    if (!sparseConfig) return EMPTY_STATUS

    const filePath = (await git.raw(['rev-parse', '--git-path', 'info/sparse-checkout'])).trim()
    if (!filePath || !existsSync(filePath)) return EMPTY_STATUS

    const cone = await readBoolConfig(git, 'core.sparseCheckoutCone')

    let patternCount = 0
    try {
      patternCount = readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')).length
    } catch {
      // Keep patternCount at 0 — file existed at the existsSync check
      // but became unreadable; still report enabled: true.
    }

    return { enabled: true, cone, patternCount }
  } catch {
    return EMPTY_STATUS
  }
}
