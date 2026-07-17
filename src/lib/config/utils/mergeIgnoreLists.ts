import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../constants'
import { Config } from '../types'
import { splitList } from './splitList'

/**
 * Ensure the canonical default ignore lists are always present in
 * the resolved config (#851). User-provided `ignoredFiles` /
 * `ignoredExtensions` arrays from XDG / git / project / env config
 * sources used to *replace* the defaults wholesale via the shallow
 * spread in each loader, which silently dropped lockfile + node_modules
 * entries the moment a user provided their own list. The reported
 * symptom: `pnpm-lock.yaml` reaching the diff-condensing pipeline
 * after a user added `.coco.config.json` for unrelated overrides.
 *
 * Now: user values are *unioned* with the defaults. Order is preserved
 * (defaults first, then user-only additions in their original order).
 * Duplicates are de-duped. The defaults can no longer be opted out of —
 * the cost of accidentally summarizing a lockfile (minutes of LLM time
 * per commit) outweighs the niche case of intentionally excluding a
 * default lockfile pattern.
 */
function unionPreservingOrder(
  base: string[],
  extras: string[] | string | undefined
): string[] {
  // Defense in depth: a loader that leaks a raw string here (instead of
  // splitting it) would otherwise be spread into individual characters —
  // normalize it back into an array first (#1675).
  const normalized = typeof extras === 'string' ? splitList(extras) : extras
  if (!normalized || normalized.length === 0) return [...base]
  const seen = new Set(base)
  const merged = [...base]
  for (const value of normalized) {
    if (!seen.has(value)) {
      seen.add(value)
      merged.push(value)
    }
  }
  return merged
}

export function mergeIgnoreLists<T extends Pick<Config, 'ignoredFiles' | 'ignoredExtensions'>>(
  config: T
): T {
  return {
    ...config,
    ignoredFiles: unionPreservingOrder(DEFAULT_IGNORED_FILES, config.ignoredFiles),
    ignoredExtensions: unionPreservingOrder(DEFAULT_IGNORED_EXTENSIONS, config.ignoredExtensions),
  }
}
