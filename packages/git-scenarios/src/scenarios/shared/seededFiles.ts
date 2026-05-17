/**
 * Thin wrapper around the deterministic content generators vendored
 * into this package at `__fixtures__/generators.ts`. The generators
 * themselves are git-agnostic (they produce file content from
 * `(filename, approxTokens, seed)`); this wrapper adds the small
 * conveniences scenarios actually need:
 *
 *   - `seededFile(seed)` — derive a per-file seed from a base + path so
 *     every file in a scenario gets distinct content, but the scenario
 *     as a whole stays deterministic.
 *   - `writeSeededFiles(...)` — bulk-write a list of file specs to a
 *     `TempGitRepo`.
 *
 * Generators are co-located inside the package rather than peer-dep'd
 * (see the README for the rationale). Scenarios depend on them in 9 of
 * 11 cases; making them required-via-injection would add friction at
 * every call site for a feature 90% of consumers want by default.
 */

import { generateContentForFile } from '../../__fixtures__/generators'
import type { TempGitRepo } from '../../tempGitRepo'

export type SeededFileSpec = {
  path: string
  /** Approximate token budget. ~chars/4. */
  tokens: number
  /**
   * Optional per-file seed offset. Defaults to a stable hash of `path`
   * so files in a scenario differ from each other without the scenario
   * having to manage seeds.
   */
  seedOffset?: number
}

/**
 * Deterministic per-file seed from a base seed + path. Same (baseSeed,
 * path) pair always returns the same number — every file in a scenario
 * gets distinct content while the whole scenario stays reproducible.
 */
export function seedForFile(baseSeed: number, path: string): number {
  let hash = 0
  for (let i = 0; i < path.length; i += 1) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0
  }
  // XOR with the base seed so passing different baseSeeds to the same
  // (path, tokens) inputs produces different content. Without this, the
  // base seed would be ignored.
  return (baseSeed ^ hash) >>> 0
}

/**
 * Generate file content using the seeded generators.
 */
export function seededContent(path: string, tokens: number, baseSeed: number, offset?: number): string {
  const seed = seedForFile(baseSeed + (offset || 0), path)
  return generateContentForFile(path, tokens, seed)
}

/**
 * Write a batch of files to the repo with deterministic content. The
 * order is preserved so the test layer can assert specific file paths
 * exist in a specific shape.
 */
export async function writeSeededFiles(
  repo: TempGitRepo,
  files: SeededFileSpec[],
  baseSeed: number,
): Promise<void> {
  for (const file of files) {
    const content = seededContent(file.path, file.tokens, baseSeed, file.seedOffset)
    await repo.writeFile(file.path, content)
  }
}
