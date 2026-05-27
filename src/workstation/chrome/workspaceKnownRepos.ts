import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Per-user list of "known" repos added via the workspace add-repo
 * prompt (#880). Persisted separately from the user's config so we
 * don't have to write back into a hand-edited (and potentially
 * version-controlled) `.coco.config.json`.
 *
 * The discovery layer merges this list with `config.workspace.knownRepos`
 * — config wins for de-dupe so users can pin repos that the
 * add-repo prompt removed via the in-app delete affordance later
 * (out of scope for v1).
 *
 * Best-effort: read failures return an empty list, write failures
 * are swallowed silently.
 */

const STORE_SCHEMA_VERSION = 1
const STORE_DIR_NAME = 'workspace'
const STORE_FILE_NAME = 'known-repos.json'

type Envelope = {
  version: number
  paths: string[]
  updatedAt: string
}

function resolveStoreDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco', STORE_DIR_NAME)
  }
  return path.join(os.homedir(), '.cache', 'coco', STORE_DIR_NAME)
}

export function getKnownReposStorePath(): string {
  return path.join(resolveStoreDir(), STORE_FILE_NAME)
}

export function readKnownRepos(): string[] {
  try {
    const raw = fs.readFileSync(getKnownReposStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as Envelope
    if (parsed.version !== STORE_SCHEMA_VERSION) {
      return []
    }
    if (!Array.isArray(parsed.paths)) {
      return []
    }
    return parsed.paths.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export function writeKnownRepos(paths: ReadonlyArray<string>): void {
  const envelope: Envelope = {
    version: STORE_SCHEMA_VERSION,
    paths: [...new Set(paths)],
    updatedAt: new Date().toISOString(),
  }
  const file = getKnownReposStorePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(envelope, null, 2))
  } catch {
    // Best-effort persistence.
  }
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
