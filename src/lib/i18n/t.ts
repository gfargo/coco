/**
 * Minimal flat message-catalog lookup. English is the only locale for now —
 * this module is the plumbing that later locale catalogs and UI migrations
 * (surfaceStates, inkKeymap, help overlay) build on. See README.md for the
 * intended pattern.
 */

/** A catalog entry: a static string, or a function producing one from args. */
export type MessageValue = string | ((args: Record<string, unknown>) => string)

/** A flat key -> message map. Keys use `<domain>.<subdomain>.<name>` dot notation. */
export type Catalog = Record<string, MessageValue>

/**
 * Look up `key` in `catalog`. Function entries are called with `args` to
 * produce the interpolated string. A missing key falls back to the key
 * itself, so an un-migrated or mistyped lookup fails loud (visible in the
 * UI) rather than silently swallowing the message.
 */
export function t(catalog: Catalog, key: string, args?: Record<string, unknown>): string {
  const entry = catalog[key]
  if (entry === undefined) return key
  return typeof entry === 'function' ? entry(args ?? {}) : entry
}
