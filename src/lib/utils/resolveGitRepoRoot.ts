import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

/**
 * Resolve the git repository root for `cwd` via `git rev-parse
 * --show-toplevel`, falling back to `cwd` itself when it isn't inside a
 * git repo (or `git` isn't available). Shared by anything that needs a
 * stable, subdirectory-invocation-proof repo identity — originally
 * extracted from the diff-summary cache's repo-path resolution (#1463),
 * reused by project config loading (#1616) so both agree on "the repo
 * root" regardless of which subdirectory a command was run from.
 */
export function resolveGitRepoRoot(cwd: string = process.cwd()): string {
  let root = cwd
  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (toplevel) {
      // git always prints forward-slash paths, even on Windows, so
      // normalize through realpathSync.native to get a native-separator,
      // fully canonical form. Windows resolves a child process's cwd to
      // its long-name form internally (even if a short 8.3 name like
      // `RUNNER~1` was passed in), so git's output is already long-form;
      // realpathSync.native (unlike plain realpathSync) also expands any
      // remaining short-name segments, keeping this in sync with however
      // the caller's cwd was spelled.
      try {
        root = fs.realpathSync.native(toplevel)
      } catch {
        root = toplevel
      }
    }
  } catch {
    // Not a git repo, or git unavailable — fall back to cwd.
  }

  return root
}
