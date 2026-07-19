import * as path from 'node:path'
import { simpleGit, SimpleGit } from 'simple-git'
import { resolveDefaultRemote } from './githubCli'

/**
 * Derive a readable `owner/repo` identifier from a git remote URL for any forge
 * (GitHub, GitLab, Bitbucket, self-hosted). Handles the remote forms git emits:
 * scp-style ssh (`git@host:owner/repo`), ssh/git/https protocol URLs, and a
 * trailing `.git`. GitLab subgroups (`group/subgroup/repo`) are preserved, and
 * absurdly deep paths are capped at the last three segments to stay readable.
 * Returns undefined when the URL doesn't parse to a path.
 *
 * Unlike `parseGitHubRemoteUrl` (github.com only), this is host-agnostic — the
 * identifier is for a LOCAL, self-serve cost report, so readability matters
 * more than canonicalizing a specific forge.
 */
export function parseRepoIdentifierFromRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  // scp-style: [user@]host:path (no scheme)
  const scp = trimmed.match(/^[^/@]+@[^/:]+:(.+)$/)
  // protocol URLs: scheme://[user@]host[:port]/path
  const proto = trimmed.match(/^[a-z]+:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i)
  const repoPath = (scp?.[1] || proto?.[1] || '').replace(/^\/+/, '')
  if (!repoPath) return undefined

  const segments = repoPath.split('/').filter(Boolean)
  if (segments.length === 0) return undefined
  if (segments.length === 1) return segments[0]
  return segments.slice(-3).join('/')
}

/**
 * Resolve a readable identifier for the repo at `cwd` (default: process.cwd()).
 * Prefers `owner/repo` from the `origin` remote (falling back to the first
 * remote), then the toplevel directory name, then undefined when not in a repo.
 * Used to tag usage records so `coco doctor --cost` can break usage down per
 * project. Never throws.
 */
export async function resolveRepoIdentifier(
  options: { cwd?: string; git?: SimpleGit } = {}
): Promise<string | undefined> {
  try {
    const git = options.git ?? (options.cwd ? simpleGit({ baseDir: options.cwd }) : simpleGit())

    const resolved = await resolveDefaultRemote(git)
    const fromRemote = resolved ? parseRepoIdentifierFromRemote(resolved.url) : undefined
    if (fromRemote) return fromRemote

    const toplevel = (await git.revparse(['--show-toplevel'])).trim()
    return toplevel ? path.basename(toplevel) : undefined
  } catch {
    return undefined
  }
}
