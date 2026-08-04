import { realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'

/**
 * Returns true when `candidate` is inside (or is) `root`, following symlinks
 * so that a symlink pointing outside the root is correctly rejected.
 *
 * Returns false when:
 * - either path cannot be resolved (file does not exist, permission error, etc.)
 * - the resolved candidate is outside the resolved root
 * - on non-Windows: any case where the resolved relative path starts with ".."
 *
 * On Windows, 8.3 short-name aliases are handled by comparing filesystem
 * identities (dev + ino) in addition to the lexical check.
 */
export function isPathWithinRoot(candidate: string, root: string): boolean {
  let resolvedCandidate: string
  let resolvedRoot: string
  try {
    resolvedCandidate = realpathSync(candidate)
    resolvedRoot = realpathSync(root)
  } catch {
    return false
  }

  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return true
  }

  // Windows can spell the same directory with either a long path or an 8.3
  // alias. If the lexical check disagrees, compare filesystem identities while
  // walking the already-realpathed candidate's ancestors. This preserves the
  // symlink boundary while accepting equivalent Windows path spellings.
  if (process.platform !== 'win32') return false

  try {
    const rootStats = statSync(resolvedRoot)
    if (rootStats.ino === 0) return false

    let current = resolvedCandidate
    while (true) {
      const currentStats = statSync(current)
      if (currentStats.dev === rootStats.dev && currentStats.ino === rootStats.ino) {
        return true
      }
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
  } catch {
    return false
  }
}

/**
 * Discriminated result from `confineRepoPath`.
 */
export type ConfineResult =
  | { ok: true; absPath: string }
  | { ok: false; reason: 'absolute' | 'traversal' | 'outside-root' }

/**
 * Validates that `filePath` (a model-emitted, untrusted string) is safe to
 * open relative to `repoRoot`.
 *
 * Gates applied in order (cheapest first):
 * 1. Absolute paths are rejected immediately.
 * 2. Any `..` segment is rejected immediately.
 * 3. The lexically-resolved absolute path must still be within `repoRoot`.
 * 4. When the file exists on disk, `isPathWithinRoot` is called to confirm the
 *    realpath (i.e. to catch symlinks that escape the root). When the file does
 *    not exist, gate 3 is sufficient — we must not turn a legitimate missing
 *    in-root path into a spurious rejection, because `isPathWithinRoot` returns
 *    false for non-existent files.
 *
 * On success returns `{ ok: true, absPath }` where `absPath` is the resolved
 * absolute path to pass to `readFile` / `execFile`.
 */
export function confineRepoPath(filePath: string, repoRoot: string): ConfineResult {
  // Gate 1: reject absolute paths.
  if (path.isAbsolute(filePath)) {
    return { ok: false, reason: 'absolute' }
  }

  // Gate 2: reject any path containing a ".." segment.
  const segments = filePath.split(/[\\/]/)
  if (segments.includes('..')) {
    return { ok: false, reason: 'traversal' }
  }

  // Gate 3: lexical confinement — ensure the resolved path starts inside the root.
  const abs = path.resolve(repoRoot, filePath)
  const lexicalRelative = path.relative(repoRoot, abs)
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    return { ok: false, reason: 'outside-root' }
  }

  // Gate 4: realpath check when the file exists (catches symlink escapes).
  try {
    // realpathSync throws when the file doesn't exist — use it only as a
    // symlink check, not as an existence gate.
    realpathSync(abs)
    if (!isPathWithinRoot(abs, repoRoot)) {
      return { ok: false, reason: 'outside-root' }
    }
  } catch {
    // File does not exist: lexical confinement above is sufficient.
    // The caller's "not found" branch will handle the missing file.
  }

  return { ok: true, absPath: abs }
}
