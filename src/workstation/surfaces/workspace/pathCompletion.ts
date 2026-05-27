import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Path completion for the workspace add-repo prompt (#880).
 *
 * Designed for the workflow "type a path, tab-complete, enter".
 * The completer:
 *   - Expands ~ / ~user prefixes
 *   - Splits the input into a directory + prefix (everything after the
 *     last slash), lists directory entries with that prefix, and
 *     returns them sorted
 *   - Returns the longest common prefix among the completions so the
 *     runtime can extend the draft on Tab
 *
 * Pure-ish — it reads the filesystem, but doesn't mutate anything.
 * Errors fall back to empty completions so a typo never crashes the
 * runtime.
 */

export type PathCompletionResult = {
  /** Directory that was scanned. */
  baseDir: string
  /** The prefix portion of the input (everything after the last slash). */
  prefix: string
  /** Matching entries sorted alphabetically; directories tagged with a trailing slash. */
  completions: string[]
  /** Longest common prefix shared by every completion (without the directory). */
  commonPrefix: string
  /** True if the completer thinks the path itself is already a directory the user could descend into. */
  isDirectory: boolean
}

export function expandHomePrefix(input: string): string {
  if (input === '~') {
    return os.homedir()
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

export function splitInput(input: string): { dir: string; prefix: string } {
  // No slash at all → treat the user as typing inside the home dir.
  const expanded = expandHomePrefix(input)
  if (!expanded) {
    return { dir: os.homedir(), prefix: '' }
  }

  const lastSlash = expanded.lastIndexOf('/')
  if (lastSlash < 0) {
    return { dir: os.homedir(), prefix: expanded }
  }
  const dir = expanded.slice(0, lastSlash + 1) || '/'
  const prefix = expanded.slice(lastSlash + 1)
  return { dir, prefix }
}

function longestCommonPrefix(values: ReadonlyArray<string>): string {
  if (values.length === 0) {
    return ''
  }
  if (values.length === 1) {
    return values[0]
  }
  let prefix = values[0]
  for (let i = 1; i < values.length; i++) {
    const candidate = values[i]
    let j = 0
    while (j < prefix.length && j < candidate.length && prefix[j] === candidate[j]) {
      j++
    }
    prefix = prefix.slice(0, j)
    if (!prefix) {
      break
    }
  }
  return prefix
}

export type CompletePathOptions = {
  /** Override the directory reader (used by tests). */
  readDirectory?: (dir: string) => string[]
  /** Override the directory-isness probe (used by tests). */
  isDirectory?: (entry: string) => boolean
  /** Override the "is this a working tree" probe — completions ending in a .git directory get a star. */
  isGitWorkingTree?: (entry: string) => boolean
  /** Hide files (default true). The workspace only cares about directories. */
  directoriesOnly?: boolean
}

const DEFAULT_PRUNE_NAMES: ReadonlySet<string> = new Set(['.git'])

export function completePath(
  input: string,
  options: CompletePathOptions = {}
): PathCompletionResult {
  const directoriesOnly = options.directoriesOnly ?? true
  const { dir, prefix } = splitInput(input)
  const readDirectory =
    options.readDirectory ??
    ((target: string) => {
      try {
        return fs.readdirSync(target)
      } catch {
        return []
      }
    })
  const isDir =
    options.isDirectory ??
    ((target: string) => {
      try {
        return fs.statSync(target).isDirectory()
      } catch {
        return false
      }
    })
  const isWorking =
    options.isGitWorkingTree ??
    ((entry: string) => {
      try {
        return fs.statSync(path.join(entry, '.git')).isDirectory()
      } catch {
        return false
      }
    })

  let rawEntries: string[]
  try {
    rawEntries = readDirectory(dir)
  } catch {
    rawEntries = []
  }

  const entries = rawEntries.filter((name) => {
    if (name.startsWith('.') && !prefix.startsWith('.')) {
      return false
    }
    if (DEFAULT_PRUNE_NAMES.has(name)) {
      return false
    }
    if (!name.startsWith(prefix)) {
      return false
    }
    if (directoriesOnly && !isDir(path.join(dir, name))) {
      return false
    }
    return true
  })

  entries.sort((a, b) => a.localeCompare(b))

  const completions = entries.map((name) => {
    const full = path.join(dir, name)
    const trailingSlash = isDir(full) ? '/' : ''
    const marker = isWorking(full) ? '*' : ''
    return `${name}${trailingSlash}${marker}`
  })

  const commonPrefix = longestCommonPrefix(entries)
  const isDirectoryAtCursor = isDir(expandHomePrefix(input))

  return {
    baseDir: dir,
    prefix,
    completions,
    commonPrefix,
    isDirectory: isDirectoryAtCursor,
  }
}

/**
 * Compose the new input after a Tab press. Extends the prefix to the
 * longest common match. If the prefix already equals the common match
 * and there's exactly one completion, append it (so a second Tab
 * commits the entry).
 */
export function applyTabCompletion(input: string, result: PathCompletionResult): string {
  if (result.completions.length === 0) {
    return input
  }
  const desiredPrefix = result.commonPrefix
  if (desiredPrefix.length > result.prefix.length) {
    return result.baseDir + desiredPrefix
  }
  if (result.completions.length === 1) {
    const only = result.completions[0]
    // Strip trailing marker characters added for display (`*`) but
    // preserve the trailing slash so the user can keep descending.
    const cleaned = only.replace(/\*$/, '')
    return result.baseDir + cleaned
  }
  return input
}
