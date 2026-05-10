import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { LogInkDiffViewMode } from '../../commands/log/inkViewModel'

/**
 * Persist the user's preferred diff view mode (unified vs side-by-side
 * split — #785) per repo. Mirrors `inkSidebarPersistence.ts` so the
 * cache layout, error model, and key derivation stay consistent across
 * settings: best-effort, XDG-friendly, no PII in the cache filename.
 */

const VALID_MODES: ReadonlyArray<LogInkDiffViewMode> = ['unified', 'split']

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco')
  }
  return path.join(os.homedir(), '.cache', 'coco')
}

function repoKey(repoPath: string): string {
  // sha1 is used here as a non-security cache-key derivation — we just
  // need a deterministic short identifier for the marker filename. No
  // PII or auth context is hashed.
  // DevSkim: ignore DS126858
  return crypto.createHash('sha1').update(repoPath).digest('hex').slice(0, 16)
}

export function getDiffViewModeMarkerPath(repoPath: string): string {
  return path.join(resolveCacheDir(), `diff-view-mode.${repoKey(repoPath)}`)
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
