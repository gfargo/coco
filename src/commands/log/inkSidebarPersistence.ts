import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { LogInkSidebarTab } from './inkViewModel'

/**
 * Persist which sidebar tab the user last had active, keyed per repo so
 * switching projects doesn't reset every other repo's preference. The
 * cache lives next to the onboarding marker (XDG-friendly) and is
 * best-effort: read/write failures fall back to the default sidebar
 * tab on next start.
 *
 * Repos are keyed by a short hash of their absolute path — no PII in
 * the cache filename, and re-creating a repo at the same path keeps
 * the same preference.
 */

const VALID_TABS: ReadonlyArray<LogInkSidebarTab> = [
  'status',
  'branches',
  'tags',
  'stashes',
  'worktrees',
]

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco')
  }
  return path.join(os.homedir(), '.cache', 'coco')
}

function repoKey(repoPath: string): string {
  return crypto.createHash('sha1').update(repoPath).digest('hex').slice(0, 16)
}

export function getSidebarTabMarkerPath(repoPath: string): string {
  return path.join(resolveCacheDir(), `sidebar-tab.${repoKey(repoPath)}`)
}

export function getSavedSidebarTab(repoPath: string): LogInkSidebarTab | undefined {
  try {
    const raw = fs.readFileSync(getSidebarTabMarkerPath(repoPath), 'utf8').trim()
    return VALID_TABS.includes(raw as LogInkSidebarTab)
      ? (raw as LogInkSidebarTab)
      : undefined
  } catch {
    return undefined
  }
}

export function saveSidebarTab(repoPath: string, tab: LogInkSidebarTab): void {
  const marker = getSidebarTabMarkerPath(repoPath)
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, tab)
  } catch {
    // Best-effort persistence; swallow.
  }
}
