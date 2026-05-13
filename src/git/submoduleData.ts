import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { SimpleGit } from 'simple-git'

/**
 * Submodule overview loader (#884).
 *
 * Surfaces the per-submodule metadata a TUI inspector needs to
 * explain a submodule row: which submodule it is (name + path),
 * what commit it's pinned at, whether its tree currently matches
 * that pin, and the tracking branch declared in `.gitmodules`.
 *
 * Detection is via `.gitmodules` (mandatory for any registered
 * submodule) plus `git submodule status` (which reports the pinned
 * commit and any modified / uninitialized state). Both are local,
 * cheap reads — we never need to contact the submodule's remote
 * for any of these fields.
 *
 * The deeper "drill into the submodule's history" navigation is
 * a separate concern (a recursive context loader + view stack
 * isolation); this module is the data foundation for both the
 * inspector side-panel and that future navigation.
 */

export type SubmoduleStatusFlag =
  /** Current commit matches the pin (clean). */
  | 'clean'
  /** Pinned commit differs from HEAD inside the submodule (`+`). */
  | 'modified'
  /** Submodule not initialized — needs `git submodule update --init` (`-`). */
  | 'uninitialized'
  /** Merge conflicts in the submodule entry (`U`). */
  | 'conflicted'

export type SubmoduleEntry = {
  /** Logical name declared in `.gitmodules` (the `[submodule "name"]` header). */
  name: string
  /** Repo-relative path the submodule mounts at. */
  path: string
  /** Pinned commit sha as recorded by the parent repo. */
  pinnedSha: string
  /** Status of the submodule's working tree relative to the pin. */
  flag: SubmoduleStatusFlag
  /**
   * Branch the submodule's `[submodule "name"]` block declares for
   * tracking, when present. Independent of the pinned commit — a
   * submodule can declare `branch = main` but still be pinned at an
   * older sha on that branch.
   */
  trackingBranch?: string
  /** Remote URL recorded in `.gitmodules`, when present. */
  url?: string
}

export type SubmoduleOverview = {
  /** True when at least one submodule is registered. */
  hasSubmodules: boolean
  entries: SubmoduleEntry[]
}

const EMPTY_OVERVIEW: SubmoduleOverview = { hasSubmodules: false, entries: [] }

type GitmodulesBlock = {
  name: string
  path?: string
  url?: string
  branch?: string
}

/**
 * Parse a `.gitmodules` file into one `GitmodulesBlock` per
 * `[submodule "<name>"]` section. The file follows git-config
 * syntax — section headers + indented key = value pairs — so we
 * use a tiny line-based parser rather than pulling in a full
 * config library.
 */
export function parseGitmodules(body: string): GitmodulesBlock[] {
  const blocks: GitmodulesBlock[] = []
  let current: GitmodulesBlock | undefined

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const headerMatch = line.match(/^\[submodule\s+"([^"]+)"\]$/)
    if (headerMatch) {
      if (current) blocks.push(current)
      current = { name: headerMatch[1] }
      continue
    }

    if (!current) continue

    const kvMatch = line.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/)
    if (!kvMatch) continue
    const key = kvMatch[1].toLowerCase()
    const value = kvMatch[2].trim()
    if (key === 'path') current.path = value
    else if (key === 'url') current.url = value
    else if (key === 'branch') current.branch = value
  }

  if (current) blocks.push(current)
  return blocks
}

/**
 * Parse the output of `git submodule status`. The format is one
 * line per submodule:
 *
 *   ` <sha> <path> (<describe>)`   – clean
 *   `+<sha> <path> (<describe>)`   – modified
 *   `-<sha> <path>`                – uninitialized
 *   `U<sha> <path>`                – conflicted
 *
 * The leading space / +/-/U is the status flag. `<describe>` (if
 * present) is `git describe`-style ref output for the pinned
 * commit — purely informational, ignored by this parser.
 */
export function parseSubmoduleStatusOutput(output: string): Array<{
  flag: SubmoduleStatusFlag
  pinnedSha: string
  path: string
}> {
  const rows: Array<{ flag: SubmoduleStatusFlag; pinnedSha: string; path: string }> = []
  for (const rawLine of output.split('\n')) {
    if (!rawLine.length) continue
    const flagChar = rawLine[0]
    const rest = rawLine.slice(1).trim()
    const tokens = rest.split(/\s+/)
    if (tokens.length < 2) continue
    const [pinnedSha, path] = tokens
    const flag: SubmoduleStatusFlag =
      flagChar === '+' ? 'modified' :
        flagChar === '-' ? 'uninitialized' :
          flagChar === 'U' ? 'conflicted' : 'clean'
    rows.push({ flag, pinnedSha, path })
  }
  return rows
}

/**
 * Load the submodule overview by reading `.gitmodules` and joining
 * with `git submodule status` output. Returns the empty-overview
 * sentinel when no `.gitmodules` is present so callers don't pay
 * the round-trip cost on repos without submodules.
 *
 * Best-effort: any failure on either input falls through to an
 * empty overview rather than disrupting the surrounding context
 * load.
 */
export async function getSubmoduleOverview(git: SimpleGit): Promise<SubmoduleOverview> {
  let repoRoot: string
  try {
    repoRoot = (await git.revparse(['--show-toplevel'])).trim()
  } catch {
    return EMPTY_OVERVIEW
  }
  if (!repoRoot) return EMPTY_OVERVIEW

  const gitmodulesPath = join(repoRoot, '.gitmodules')
  if (!existsSync(gitmodulesPath)) return EMPTY_OVERVIEW

  let body: string
  try {
    body = readFileSync(gitmodulesPath, 'utf8')
  } catch {
    return EMPTY_OVERVIEW
  }
  const blocks = parseGitmodules(body)
  if (blocks.length === 0) return EMPTY_OVERVIEW

  let statusOutput = ''
  try {
    statusOutput = await git.raw(['submodule', 'status'])
  } catch {
    statusOutput = ''
  }
  const statusRows = parseSubmoduleStatusOutput(statusOutput)
  const statusByPath = new Map(statusRows.map((row) => [row.path, row]))

  const entries: SubmoduleEntry[] = blocks
    .filter((block) => Boolean(block.path))
    .map((block) => {
      const path = block.path as string
      const status = statusByPath.get(path)
      return {
        name: block.name,
        path,
        pinnedSha: status?.pinnedSha || '',
        flag: status?.flag || 'uninitialized',
        trackingBranch: block.branch,
        url: block.url,
      }
    })

  return { hasSubmodules: entries.length > 0, entries }
}

/**
 * Lookup helper: returns the submodule entry that owns a given
 * repo-relative path, or undefined when the path isn't a submodule
 * root. Used by the diff renderer + inspector to decide whether to
 * route a row through submodule-aware rendering.
 */
export function findSubmoduleByPath(
  overview: SubmoduleOverview,
  repoRelativePath: string,
): SubmoduleEntry | undefined {
  return overview.entries.find((entry) => entry.path === repoRelativePath)
}
