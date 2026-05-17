import type { Step } from './types'

/**
 * Register a named remote against a URL (`git remote add <name> <url>`).
 * Useful for multi-remote scenarios — `upstream` + `origin`, fork
 * topologies, or tests that exercise `fetch` / `push` URL plumbing.
 *
 *   addRemote('origin', 'git@github.com:gfargo/coco.git')
 *   addRemote('upstream', 'git@github.com:source-org/coco.git')
 *
 * Scenarios default to no remote so the test isolation story stays
 * simple; reach for this atom whenever a test or downstream tool
 * needs to detect a remote, parse its URL, or differentiate origin
 * from upstream. The URL is stored as-is — no fetch happens — so the
 * URL can point at anything (real github URL, file:// path, fake URL
 * for shape-only validation).
 */
export function addRemote(name: string, url: string): Step {
  return async (repo) => {
    await repo.git.addRemote(name, url)
  }
}

/**
 * Remove a named remote (`git remote remove <name>`). Useful for
 * verifying behavior when an expected remote is absent, or for
 * tearing down a remote a previous atom added before adding a
 * different one with the same name.
 */
export function removeRemote(name: string): Step {
  return async (repo) => {
    await repo.git.removeRemote(name)
  }
}

/**
 * Rename an existing remote (`git remote rename <from> <to>`). Most
 * commonly used to test the "migrate origin → upstream" workflow
 * fork users follow when they shift the canonical remote.
 */
export function renameRemote(from: string, to: string): Step {
  return async (repo) => {
    await repo.git.raw(['remote', 'rename', from, to])
  }
}
