/**
 * `autoFixToolOptions` can only reach an adapter from a trusted config layer
 * now (repo-local project config is blocked from setting it at all — see
 * `TRUSTED_PROJECT_TOP_LEVEL_KEYS`), but adapters filtered their own keys
 * regardless: a blind `--${key} ${value}` forward (or, worse, `CodexAdapter`'s
 * `-c ${key}=${value}` passthrough into codex's config namespace) trusts
 * whatever wrote the trusted layer to never contain a permission- or
 * sandbox-bypass flag. An explicit per-adapter allowlist makes that a
 * property of the code instead of an assumption about every past and future
 * caller (#1840).
 *
 * Drops any key not in `allowedKeys`, warning once per rejected key so a
 * mistyped or unsupported flag is visible instead of silently ignored.
 */
export function filterAllowedOptions(
  options: Record<string, string> | undefined,
  allowedKeys: ReadonlySet<string>,
  toolName: string
): Record<string, string> | undefined {
  if (!options) return options

  const allowed: Record<string, string> = {}
  const rejected: string[] = []

  for (const [key, value] of Object.entries(options)) {
    if (allowedKeys.has(key)) {
      allowed[key] = value
    } else {
      rejected.push(key)
    }
  }

  if (rejected.length > 0) {
    console.warn(
      `[coco] auto-fix warning: "${toolName}" does not accept autoFixToolOptions key(s) ` +
        `${rejected.join(', ')} — ignoring. Allowed keys: ${[...allowedKeys].sort().join(', ')}.`
    )
  }

  return allowed
}
