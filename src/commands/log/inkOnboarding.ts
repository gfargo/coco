import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Track whether the user has seen the first-launch onboarding overlay
 * (P1.3 from #756) via an XDG-friendly marker file. We persist this
 * outside of `.coco.config.json` so a fresh repo doesn't re-show the
 * tip when the user already dismissed it elsewhere.
 *
 * The marker is touched empty — its existence is the signal. Writes
 * are best-effort: filesystem failures (read-only $HOME, permissions)
 * fall back to "already seen" so we never block startup.
 */

const MARKER_BASENAME = 'onboarding.seen'

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco')
  }
  return path.join(os.homedir(), '.cache', 'coco')
}

export function getOnboardingMarkerPath(): string {
  return path.join(resolveCacheDir(), MARKER_BASENAME)
}

export function hasSeenOnboarding(): boolean {
  try {
    return fs.existsSync(getOnboardingMarkerPath())
  } catch {
    // If we can't even stat the path (sandboxed env, etc.), treat the
    // user as "seen" so we don't keep showing a panel they can never
    // dismiss persistently.
    return true
  }
}

export function markOnboardingSeen(): void {
  const markerPath = getOnboardingMarkerPath()
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, '')
  } catch {
    // Best-effort persistence; swallow.
  }
}
