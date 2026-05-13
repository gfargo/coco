import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { minimatch } from 'minimatch'
import { SimpleGit } from 'simple-git'

/**
 * `.gitattributes`-based LFS tracking detection (#884).
 *
 * The patch-content LFS detection in `lfsPointer.ts` only fires
 * for modified-but-tracked rows. Two complementary surfaces also
 * benefit from knowing "this file is LFS-tracked, even if its
 * pointer hasn't changed":
 *
 *   - The status / worktree views can show an "LFS" badge on
 *     tracked rows so the user knows the on-disk content is a
 *     pointer, not the real binary.
 *   - The commit-diff file list can mark LFS-tracked rows so the
 *     surface can hint "binary file (LFS)" even when the diff
 *     itself doesn't carry the pointer (e.g. rename without
 *     content change).
 *
 * This module owns the detection. `.gitattributes` files can live
 * at any depth in the repo and patterns are scoped to the
 * directory their file sits in (gitignore-style precedence). For
 * our purposes — flagging LFS rows — we read every `.gitattributes`
 * the repo's filtered file listing knows about and union their
 * patterns, anchored to the file's directory.
 */

export type LfsAttributePattern = {
  /** Directory the pattern is anchored to (repo-relative). Empty string for the repo root. */
  baseDir: string
  /** Raw glob from the `.gitattributes` entry (e.g. `*.bin`, `videos/*`). */
  pattern: string
}

export type LfsAttributeStatus = {
  /** True when any `.gitattributes` defines a `filter=lfs` pattern. */
  enabled: boolean
  /** Patterns sourced from every `.gitattributes` discovered. */
  patterns: LfsAttributePattern[]
}

const EMPTY_STATUS: LfsAttributeStatus = { enabled: false, patterns: [] }

/**
 * Parse a single `.gitattributes` body into the LFS-tracked
 * patterns it declares. Each line in the file has the shape
 * `<pattern> <attr1> <attr2> ...`. We collect lines that include
 * a `filter=lfs` attribute (the canonical LFS marker); other
 * attributes are ignored. Blank lines and comment lines (`#`) are
 * skipped.
 *
 * Exported for direct testing; the loader composes this with file
 * discovery.
 */
export function parseLfsAttributes(body: string, baseDir: string): LfsAttributePattern[] {
  const patterns: LfsAttributePattern[] = []

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const tokens = line.split(/\s+/)
    if (tokens.length < 2) continue
    const pattern = tokens[0]
    const attrs = tokens.slice(1)
    if (attrs.includes('filter=lfs')) {
      patterns.push({ baseDir, pattern })
    }
  }

  return patterns
}

/**
 * Resolve the repo root using `git rev-parse --show-toplevel`, then
 * load every `.gitattributes` file the repo tracks (via `git
 * ls-files`) and union their LFS patterns. Returns the empty status
 * sentinel when none are present so callers don't pay a refresh
 * cost on repos without LFS.
 *
 * Best-effort: `.gitattributes` files that don't parse, missing
 * permissions, or a missing repo root all fall through to the
 * empty status. Errors here would otherwise cripple the worktree
 * load path for an LFS-detection feature that's strictly additive.
 */
export async function getLfsAttributeStatus(git: SimpleGit): Promise<LfsAttributeStatus> {
  let repoRoot: string
  try {
    repoRoot = (await git.revparse(['--show-toplevel'])).trim()
  } catch {
    return EMPTY_STATUS
  }
  if (!repoRoot) return EMPTY_STATUS

  let trackedFiles: string[]
  try {
    const output = await git.raw(['ls-files', '--', '.gitattributes', '**/.gitattributes'])
    trackedFiles = output.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    trackedFiles = []
  }
  // Always include a repo-root `.gitattributes` that may exist but
  // isn't tracked (rare but possible during bootstrap). Untracked
  // attribute files still influence git's behavior at runtime.
  const rootAttrs = '.gitattributes'
  if (!trackedFiles.includes(rootAttrs) && existsSync(join(repoRoot, rootAttrs))) {
    trackedFiles.push(rootAttrs)
  }

  const patterns: LfsAttributePattern[] = []
  for (const relPath of trackedFiles) {
    const absPath = join(repoRoot, relPath)
    if (!existsSync(absPath)) continue
    let body: string
    try {
      body = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }
    const baseDir = relPath === rootAttrs ? '' : relPath.replace(/\/?\.gitattributes$/, '')
    patterns.push(...parseLfsAttributes(body, baseDir))
  }

  return { enabled: patterns.length > 0, patterns }
}

/**
 * Returns true when a repo-relative path is matched by any of the
 * tracked LFS patterns. Each pattern is anchored to the directory
 * its `.gitattributes` file sits in: e.g. a pattern `*.bin` from
 * `assets/.gitattributes` matches `assets/foo.bin` but not
 * `src/foo.bin`.
 *
 * The matcher uses minimatch (the dependency the rest of the
 * codebase already relies on). Globstar is enabled so patterns
 * like `videos/<globstar>/<star>.mp4` behave as users expect.
 */
export function isPathLfsTracked(
  status: LfsAttributeStatus,
  repoRelativePath: string,
): boolean {
  if (!status.enabled) return false
  for (const { baseDir, pattern } of status.patterns) {
    if (baseDir && !repoRelativePath.startsWith(`${baseDir}/`) && repoRelativePath !== baseDir) {
      continue
    }
    const scoped = baseDir ? repoRelativePath.slice(baseDir.length + 1) : repoRelativePath
    if (minimatch(scoped, pattern, { matchBase: !pattern.includes('/'), dot: true })) {
      return true
    }
  }
  return false
}
