import * as fs from 'node:fs'
import * as path from 'node:path'

import { writeFileAtomic } from '../../lib/utils/atomicFileWrite'
import { getCocoCacheDir } from '../../lib/utils/cocoPaths'

/**
 * Shared XDG-friendly JSON persistence used by every chrome cache /
 * preferences module (workspace overview cache, known-repos store,
 * preferences, onboarding marker, …).
 *
 * Each store is a schema-versioned `{ version, ...payload }` JSON
 * file under `~/.cache/coco/<subdir>/`. The helper handles:
 *
 *   - XDG_CACHE_HOME override (per spec)
 *   - mkdir -p before write
 *   - try/catch on read AND write (best-effort persistence so a
 *     read-only $HOME never crashes boot)
 *   - schema-version guard on read (anything that doesn't match the
 *     current version is treated as "no data")
 *
 * Callers supply the file basename, schema version, and a `validate`
 * predicate that narrows the parsed payload to the typed shape. The
 * helper returns `read()` / `write()` / `path()` so the call site
 * stays declarative.
 */

export type JsonStoreOptions<T> = {
  /**
   * Subdirectory under `<cache>/coco/`. Use a stable string per
   * store category (e.g. `'workspace'`).
   */
  subdir: string
  /**
   * Filename including extension. Either a static string ("known-repos.json")
   * or a function for per-key files (e.g. `roots => `overview.${hash}.json``).
   */
  basename: string | ((key: string) => string)
  /** Schema version stamped into the envelope; mismatch on read returns undefined. */
  version: number
  /**
   * Field name in the envelope where the payload lives. Default `payload`.
   * Existing stores pin their legacy field name (`overview`, `preferences`,
   * `paths`, …) so on-disk files written by previous versions remain
   * readable after refactoring.
   */
  payloadField?: string
  /**
   * Narrow the parsed payload (already version-checked) into the
   * typed `T`. Return `undefined` for any input that doesn't match
   * the expected shape.
   */
  validate: (payload: unknown) => T | undefined
  /**
   * Optional formatter — `'pretty'` writes JSON with 2-space indent
   * (default), `'compact'` writes a single line. Pretty makes the
   * file diff-friendly for the user; compact saves bytes for stores
   * the user never opens directly.
   */
  format?: 'pretty' | 'compact'
}

export type JsonStore<T> = {
  /** Read + version-check + validate. Returns `undefined` when missing/invalid. */
  read: (key?: string) => T | undefined
  /** Stamp the envelope, mkdir -p, and write. Errors swallowed. */
  write: (value: T, key?: string) => void
  /** Compute the absolute file path the store reads from / writes to. */
  path: (key?: string) => string
}

type RawEnvelope = {
  version: number
  savedAt?: string
} & Record<string, unknown>

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const indent = options.format === 'compact' ? undefined : 2
  const payloadField = options.payloadField ?? 'payload'
  const resolveBasename = (key?: string): string => {
    if (typeof options.basename === 'string') return options.basename
    return options.basename(key ?? '')
  }
  const resolvePath = (key?: string): string =>
    path.join(getCocoCacheDir(options.subdir), resolveBasename(key))

  return {
    path: resolvePath,
    read(key) {
      try {
        const raw = fs.readFileSync(resolvePath(key), 'utf8')
        const parsed = JSON.parse(raw) as RawEnvelope
        if (parsed.version !== options.version) return undefined
        return options.validate(parsed[payloadField])
      } catch {
        return undefined
      }
    },
    write(value, key) {
      const envelope: RawEnvelope = {
        version: options.version,
        savedAt: new Date().toISOString(),
        [payloadField]: value,
      }
      const file = resolvePath(key)
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        // tmp+rename (same as themePersistence) so a crash/SIGKILL
        // mid-write can't leave truncated JSON — the read path would
        // treat that as "no data" and silently drop the store. The
        // random-suffixed 0600/O_EXCL tmp keeps two coco instances from
        // clobbering (or an attacker from pre-planting) each other's
        // tmp file; rename is atomic, so concurrent writers degrade to
        // last-writer-wins instead of corruption.
        writeFileAtomic(file, JSON.stringify(envelope, null, indent))
      } catch {
        // Best-effort persistence.
      }
    },
  }
}
