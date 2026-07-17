/**
 * Normalize a config value that should be a string array. Loaders that read
 * from ini/env sources deliver comma-separated (or single-token) strings —
 * splitting naively on iteration would spread the string into individual
 * characters (#1675). Arrays and undefined pass through unchanged.
 */
export function splitList(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
