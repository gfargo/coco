import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * First-run onboarding marker for the workspace surface (#880
 * follow-up). Sibling of `chrome/onboarding.ts` — kept separate so
 * dismissing the workspace's first-run hint doesn't suppress the
 * existing `coco ui` overlay (and vice versa).
 *
 * Best-effort persistence: read/write failures fall back to "already
 * seen" so we never block boot or pester the user on a write-only
 * filesystem.
 */

const MARKER_BASENAME = 'workspace-onboarding.seen'

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco')
  }
  return path.join(os.homedir(), '.cache', 'coco')
}

export function getWorkspaceOnboardingMarkerPath(): string {
  return path.join(resolveCacheDir(), MARKER_BASENAME)
}

export function hasSeenWorkspaceOnboarding(): boolean {
  try {
    return fs.existsSync(getWorkspaceOnboardingMarkerPath())
  } catch {
    return true
  }
}

export function markWorkspaceOnboardingSeen(): void {
  const markerPath = getWorkspaceOnboardingMarkerPath()
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, '')
  } catch {
    // Best-effort persistence; swallow.
  }
}
