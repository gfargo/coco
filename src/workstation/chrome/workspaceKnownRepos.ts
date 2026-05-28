import { createJsonStore } from './jsonStore'

/**
 * Per-user list of "known" repos added via the workspace add-repo
 * prompt (#880). Persisted separately from the user's config so we
 * don't have to write back into a hand-edited (and potentially
 * version-controlled) `.coco.config.json`.
 *
 * The discovery layer merges this list with `config.workspace.knownRepos`
 * — config wins for de-dupe (see `mergeKnownRepos` in `runtime.ts`).
 *
 * Persistence is delegated to `jsonStore.ts`.
 */

const STORE_SCHEMA_VERSION = 1

const store = createJsonStore<string[]>({
  subdir: 'workspace',
  basename: 'known-repos.json',
  version: STORE_SCHEMA_VERSION,
  // Legacy on-disk shape carries the array directly under `paths`,
  // not nested. Pin the field so existing files remain readable.
  payloadField: 'paths',
  validate: (raw) =>
    Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
})

export function getKnownReposStorePath(): string {
  return store.path()
}

export function readKnownRepos(): string[] {
  return store.read() ?? []
}

export function writeKnownRepos(paths: ReadonlyArray<string>): void {
  store.write([...new Set(paths)])
}

/**
 * Add a new entry and persist. Returns the updated, de-duplicated
 * list. Caller is responsible for resolving the input path before
 * passing it (e.g., realpath / home-prefix expansion) so the stored
 * value is canonical.
 */
export function appendKnownRepo(repoPath: string): string[] {
  const existing = readKnownRepos()
  if (existing.includes(repoPath)) {
    return existing
  }
  const next = [...existing, repoPath]
  writeKnownRepos(next)
  return next
}

/**
 * Remove an entry from the store. No-op when the path isn't present.
 * Returns the updated list so the caller can echo it into state
 * without re-reading from disk.
 */
export function removeKnownRepo(repoPath: string): string[] {
  const existing = readKnownRepos()
  if (!existing.includes(repoPath)) {
    return existing
  }
  const next = existing.filter((entry) => entry !== repoPath)
  writeKnownRepos(next)
  return next
}
