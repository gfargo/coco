/**
 * Prefetch orchestrator for lazy-loaded tree-sitter parsers
 * (#933 phase 3).
 *
 * Reads the `COCO_PREFETCH` environment variable at CLI startup
 * and downloads any requested-but-missing parsers into the
 * cache. Wired into `src/index.ts`'s entry path so it runs
 * before any command logic that might consult the parser.
 *
 * Syntax for the env var:
 *
 *   COCO_PREFETCH=py            single language
 *   COCO_PREFETCH=py,rs,go      comma-separated list
 *   COCO_PREFETCH=all           every language in the manifest
 *   COCO_PREFETCH=               (empty / unset → no-op)
 *
 * Unrecognized language ids are skipped with a warning to stderr.
 * Already-cached languages are skipped silently. The orchestrator
 * processes the list serially — five parallel downloads to the
 * same CDN don't get five-times faster, and serial-with-progress
 * is a calmer UX.
 *
 * Errors don't crash the CLI. A failed download (network outage,
 * SHA mismatch) prints a warning and continues; the user's
 * subsequent `coco commit` simply falls through to the regex
 * parser for that language. The CLI logs surface the failure so
 * the user knows to retry; we never silently leave the user
 * thinking they got tree-sitter when they didn't.
 */

import {
  isLanguageCached,
  LazyTreeSitterLanguageId,
} from './cache'
import {
  downloadTreeSitterParser,
  formatDownloadOutcome,
} from './download'
import {
  listManifestLanguages,
  TREE_SITTER_MANIFEST,
} from './manifest'

/**
 * Short aliases the user can write in the env var. Mirrors the
 * existing `languageAware.languages` config knob from phase 1
 * (`'ts' | 'js' | 'py' | 'rs' | 'go'`).
 */
const ALIASES: Record<string, LazyTreeSitterLanguageId> = {
  py: 'python',
  python: 'python',
}

export type PrefetchResult = {
  /** Languages the user asked for that this run resolved to a manifest entry. */
  requested: LazyTreeSitterLanguageId[]
  /** Languages already cached at start — no-op skipped. */
  alreadyCached: LazyTreeSitterLanguageId[]
  /** Languages successfully downloaded + cached during this run. */
  downloaded: LazyTreeSitterLanguageId[]
  /** Languages whose download failed (network / SHA / write). */
  failed: LazyTreeSitterLanguageId[]
  /** Aliases the user passed that didn't resolve to a known language. */
  unknown: string[]
}

/**
 * Parse the COCO_PREFETCH env var into a list of language ids.
 * Returns an empty list when unset, empty, or set to garbage —
 * the orchestrator turns that into a no-op.
 *
 * Exported for direct testing.
 */
export function parsePrefetchEnv(raw: string | undefined): {
  resolved: LazyTreeSitterLanguageId[]
  unknown: string[]
} {
  if (!raw || !raw.trim()) return { resolved: [], unknown: [] }
  const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (tokens.includes('all')) {
    return { resolved: listManifestLanguages(), unknown: [] }
  }
  const resolved: LazyTreeSitterLanguageId[] = []
  const unknown: string[] = []
  const seen = new Set<LazyTreeSitterLanguageId>()
  for (const token of tokens) {
    const resolvedId = ALIASES[token]
    if (!resolvedId) {
      unknown.push(token)
      continue
    }
    if (!seen.has(resolvedId)) {
      seen.add(resolvedId)
      resolved.push(resolvedId)
    }
  }
  return { resolved, unknown }
}

/**
 * Download every requested language that isn't already cached.
 * Returns a structured result; the caller decides whether to
 * print summary lines.
 */
export async function prefetchTreeSitterParsers(
  languages: LazyTreeSitterLanguageId[],
  options?: {
    /** Test seam — defaults to the real download module. */
    download?: typeof downloadTreeSitterParser
    /** Receives each per-language status line. Defaults to stderr. */
    writeLine?: (line: string) => void
  },
): Promise<PrefetchResult> {
  const download = options?.download || downloadTreeSitterParser
  const writeLine = options?.writeLine || ((line: string) => process.stderr.write(`${line}\n`))

  const result: PrefetchResult = {
    requested: languages,
    alreadyCached: [],
    downloaded: [],
    failed: [],
    unknown: [],
  }

  for (const language of languages) {
    if (isLanguageCached(language)) {
      result.alreadyCached.push(language)
      continue
    }
    const entry = TREE_SITTER_MANIFEST[language]
    writeLine(`· ${entry.displayName}: downloading ${entry.wasmUrl}…`)
    const outcome = await download(language)
    writeLine(formatDownloadOutcome(language, outcome))
    if (outcome.ok) {
      result.downloaded.push(language)
    } else {
      result.failed.push(language)
    }
  }

  return result
}

/**
 * The startup hook: read `COCO_PREFETCH` from the environment,
 * resolve aliases, run any necessary downloads, log the outcome.
 * No-op when the env var is unset, so the CLI's typical path
 * pays zero overhead.
 */
export async function runPrefetchFromEnv(
  options?: {
    env?: NodeJS.ProcessEnv
    download?: typeof downloadTreeSitterParser
    writeLine?: (line: string) => void
  },
): Promise<PrefetchResult> {
  const env = options?.env || process.env
  const writeLine = options?.writeLine || ((line: string) => process.stderr.write(`${line}\n`))
  const { resolved, unknown } = parsePrefetchEnv(env.COCO_PREFETCH)

  if (resolved.length === 0 && unknown.length === 0) {
    return {
      requested: [],
      alreadyCached: [],
      downloaded: [],
      failed: [],
      unknown: [],
    }
  }

  if (unknown.length > 0) {
    writeLine(`! COCO_PREFETCH: ignoring unknown language(s): ${unknown.join(', ')}. Known: ${listManifestLanguages().join(', ')}`)
  }

  const result = await prefetchTreeSitterParsers(resolved, { download: options?.download, writeLine })
  result.unknown = unknown
  return result
}
