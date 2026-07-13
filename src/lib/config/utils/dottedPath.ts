/**
 * Minimal dotted-key-path helpers for `coco config` (#1605) — `get`/`set`/
 * `unset`/`flatten` over plain JSON-shaped objects (`service.model`,
 * `logTui.theme.preset`, ...). No array-index syntax; coco's config schema
 * doesn't nest arrays deep enough to need it.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function splitDottedPath(key: string): string[] {
  return key.split('.').filter(Boolean)
}

/**
 * The persisted-config on-disk shape (both the XDG JSON file and
 * `~/.gitconfig`'s `[coco]` section) stores the API key flat, as
 * `service.apiKey` — see `parseServiceConfig`'s `openai`/`anthropic`/etc.
 * cases in `services/xdg.ts` and `serviceApiKey` in `services/git.ts`.
 * The runtime `Config`/`LLMService` TYPE nests it instead, at
 * `service.authentication.credentials.apiKey` — that's the shape schema
 * validation and `coco doctor` present. `coco config` accepts the
 * type-shaped dotted path (the one a user would actually reach for) and
 * transparently aliases it to the on-disk flat key wherever it reads or
 * writes a scoped file directly, so a written key is one the loaders
 * actually pick back up.
 */
export function toOnDiskConfigKey(key: string): string {
  return key === 'service.authentication.credentials.apiKey' ? 'service.apiKey' : key
}

/** Reads a dotted-path value out of `obj`. Returns undefined if any segment is missing. */
export function getDottedPath(obj: unknown, key: string): unknown {
  const segments = splitDottedPath(key)
  let current: unknown = obj

  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined
    current = current[segment]
  }

  return current
}

/**
 * Sets a dotted-path value into `obj`, creating intermediate objects as
 * needed. Mutates and returns `obj`.
 */
export function setDottedPath<T extends Record<string, unknown>>(obj: T, key: string, value: unknown): T {
  const segments = splitDottedPath(key)
  if (segments.length === 0) return obj

  let current: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (!isPlainObject(current[segment])) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  current[segments[segments.length - 1]] = value
  return obj
}

/**
 * Removes a dotted-path key from `obj`, if present. Mutates and returns
 * `obj`. Leaves now-empty intermediate objects in place rather than
 * pruning them — harmless, and pruning risks deleting a sibling-holding
 * object a caller didn't expect touched.
 */
export function unsetDottedPath<T extends Record<string, unknown>>(obj: T, key: string): T {
  const segments = splitDottedPath(key)
  if (segments.length === 0) return obj

  let current: unknown = obj
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isPlainObject(current)) return obj
    current = current[segments[i]]
  }

  if (isPlainObject(current)) {
    delete current[segments[segments.length - 1]]
  }

  return obj
}

/** Flattens a nested object into `{ "a.b.c": value }` entries, for `config list`. */
export function flattenToDottedPaths(obj: unknown, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (!isPlainObject(obj)) {
    if (prefix) result[prefix] = obj
    return result
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      Object.assign(result, flattenToDottedPaths(value, path))
    } else {
      result[path] = value
    }
  }

  return result
}

/**
 * Best-effort coercion of a CLI string value into a JSON-typed value:
 * `"true"`/`"false"` → boolean, a numeric string → number, valid JSON
 * (arrays/objects) → parsed, anything else → the original string.
 */
export function coerceConfigValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
