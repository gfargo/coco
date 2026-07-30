import { SimpleGit } from 'simple-git'

/** Configured remote names (best-effort; `[]` if the call fails). */
export async function listRemotes(git: SimpleGit): Promise<string[]> {
  try {
    return (await git.getRemotes()).map((remote) => remote.name).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Remote name to use for operations needing a single remote: `origin` when
 * it exists, else the first configured remote, else `undefined` (no remotes
 * configured). Shared by branch and tag push/delete actions.
 */
export async function resolveDefaultRemoteName(git: SimpleGit): Promise<string | undefined> {
  const remotes = await listRemotes(git)
  if (remotes.length === 0) return undefined
  return remotes.includes('origin') ? 'origin' : remotes[0]
}
