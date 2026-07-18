import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Shared XDG-friendly cache dir resolution. `XDG_CACHE_HOME` wins when set to
 * a non-whitespace value (per spec); otherwise falls back to `~/.cache`.
 * Every chrome/git/lib cache & marker-file module should route through this
 * so the fallback logic never drifts between copies again.
 */
export function getCocoCacheDir(subdir?: string): string {
  const xdg = process.env.XDG_CACHE_HOME
  const root = xdg && xdg.trim().length > 0 ? xdg : path.join(os.homedir(), '.cache')
  return subdir ? path.join(root, 'coco', subdir) : path.join(root, 'coco')
}

// sha1 is used here as a non-security cache-key derivation — we just need a
// deterministic short identifier for cache filenames / marker names. No PII
// or auth context is hashed, and no collision-resistance against an
// adversary is required.
// DevSkim: ignore DS126858
export function cacheKeyHash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)
}
