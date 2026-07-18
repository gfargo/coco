import * as fs from 'node:fs'
import * as path from 'node:path'

import { LogInkDiffViewMode } from '../../workstation/runtime/inkViewModel'
import { cacheKeyHash, getCocoCacheDir } from '../../lib/utils/cocoPaths'

/**
 * Persist the user's preferred diff view mode (unified vs side-by-side
 * split — #785) per repo. Mirrors `inkSidebarPersistence.ts` so the
 * cache layout, error model, and key derivation stay consistent across
 * settings: best-effort, XDG-friendly, no PII in the cache filename.
 */

const VALID_MODES: ReadonlyArray<LogInkDiffViewMode> = ['unified', 'split']

export function getDiffViewModeMarkerPath(repoPath: string): string {
  return path.join(getCocoCacheDir(), `diff-view-mode.${cacheKeyHash(repoPath)}`)
}

export function getSavedDiffViewMode(repoPath: string): LogInkDiffViewMode | undefined {
  try {
    const raw = fs.readFileSync(getDiffViewModeMarkerPath(repoPath), 'utf8').trim()
    return VALID_MODES.includes(raw as LogInkDiffViewMode)
      ? (raw as LogInkDiffViewMode)
      : undefined
  } catch {
    return undefined
  }
}

export function saveDiffViewMode(repoPath: string, mode: LogInkDiffViewMode): void {
  const marker = getDiffViewModeMarkerPath(repoPath)
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, mode)
  } catch {
    // Best-effort persistence; swallow.
  }
}
