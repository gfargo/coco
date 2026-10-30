import { SimpleGit } from 'simple-git'

/**
 * Remote overview loader (#0.71 — expanded git ops).
 *
 * Surfaces the per-remote metadata the Remotes view needs to render a
 * row: which remote it is (name) and the fetch / push URLs it points
 * at. A remote can carry distinct fetch and push URLs (a common
 * read-from-upstream / push-to-fork setup), so both are reported.
 *
 * Detection is via `git remote -v`, which lists one `<name>\t<url>
 * (fetch)` / `<name>\t<url> (push)` line per remote — a single cheap,
 * local read. No network round-trip is ever required.
 *
 * Best-effort: any failure falls through to the empty-overview
 * sentinel rather than disrupting the surrounding context load,
 * matching `submoduleData.ts`.
 */

export type RemoteEntry = {
  /** Remote name (the `[remote "name"]` short name, e.g. `origin`). */
  name: string
  /** URL git fetches from. */
  fetchUrl: string
  /**
   * URL git pushes to. Equals `fetchUrl` for the common single-URL
   * remote; differs when a separate push URL is configured.
   */
  pushUrl: string
}

export type RemoteOverview = {
  /** True when at least one remote is configured. */
  hasRemotes: boolean
  entries: RemoteEntry[]
}

const EMPTY_OVERVIEW: RemoteOverview = { hasRemotes: false, entries: [] }

/**
 * Parse the output of `git remote -v`. The format is two lines per
 * remote:
 *
 *   `origin\t<url> (fetch)`
 *   `origin\t<url> (push)`
 *
 * Remotes are grouped by name; the fetch line seeds `fetchUrl`, the
 * push line seeds `pushUrl`. A remote with only one of the two (rare,
 * but possible with a custom config) falls back to the URL it does
 * have for the missing direction so a row never renders a blank URL.
 */
export function parseRemoteVerboseOutput(output: string): RemoteEntry[] {
  const byName = new Map<string, { fetchUrl?: string; pushUrl?: string }>()
  const order: string[] = []

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // `<name>\t<url> (fetch|push)` — split the leading name off the
    // tab, then peel the trailing ` (fetch)` / ` (push)` marker.
    const match = line.match(/^(\S+)\s+(.*?)\s+\((fetch|push)\)$/)
    if (!match) continue
    const [, name, url, direction] = match
    if (!byName.has(name)) {
      byName.set(name, {})
      order.push(name)
    }
    const slot = byName.get(name) as { fetchUrl?: string; pushUrl?: string }
    if (direction === 'fetch') slot.fetchUrl = url
    else slot.pushUrl = url
  }

  return order.map((name) => {
    const slot = byName.get(name) as { fetchUrl?: string; pushUrl?: string }
    const fetchUrl = slot.fetchUrl || slot.pushUrl || ''
    const pushUrl = slot.pushUrl || slot.fetchUrl || ''
    return { name, fetchUrl, pushUrl }
  })
}

/**
 * Load the remote overview from `git remote -v`. Returns the
 * empty-overview sentinel when no remotes are configured (or the
 * command fails), so callers don't pay any cost on remote-less repos.
 */
export async function getRemoteOverview(git: SimpleGit): Promise<RemoteOverview> {
  let output = ''
  try {
    output = await git.raw(['remote', '-v'])
  } catch {
    return EMPTY_OVERVIEW
  }
  const entries = parseRemoteVerboseOutput(output)
  return { hasRemotes: entries.length > 0, entries }
}

/**
 * Hide credentials embedded in a remote URL before it is displayed or
 * copied (#2204). `https://user:token@host/x` and `https://TOKEN@host/x`
 * (token-as-username) lose their userinfo entirely; for other schemes
 * (`ssh://git@host/x`) only a password is masked, since the bare user is
 * not a secret. scp-style `git@host:path` has no scheme and is untouched.
 */
export function maskUrlCredentials(url: string): string {
  // Userinfo runs to the LAST `@` in the authority: a hand-typed password
  // can hold a raw `@`, and splitting at the first one showed its tail.
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/\s]+)@([^/@\s]*(?:\/.*)?)$/i.exec(url)
  if (!match) return url
  const [, scheme, userinfo, rest] = match
  if (/^https?:|^ftps?:/i.test(scheme)) return `${scheme}***@${rest}`
  const colon = userinfo.indexOf(':')
  return colon === -1 ? url : `${scheme}${userinfo.slice(0, colon)}:***@${rest}`
}
