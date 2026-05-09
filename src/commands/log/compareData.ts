import { SimpleGit } from 'simple-git'

/**
 * Compare two refs (branches / tags / commits) and return the unified
 * patch as line-split string output (#779).
 *
 * Mirrors the stash-diff loader's contract — emits `string[]` so the
 * existing diff surface can render the lines through its standard
 * +/-/@@ coloring path. Two-dot syntax (`base..head`) gives the
 * "what changed on head, relative to base" view that's natural for
 * branch reviews and pre-merge sanity checks.
 *
 * Defensive about input — both refs are passed as-is to git, so the
 * caller is responsible for providing a git-resolvable form
 * (branch shortName, tag name, or commit hash). On any git error
 * (unknown ref, etc.) the runtime's `safe()` wrapper at the call
 * site catches the throw and the surface falls back to a "no diff"
 * hint.
 */
export async function getCompareDiff(
  git: SimpleGit,
  base: string,
  head: string
): Promise<string[]> {
  return (await git.raw(['diff', `${base}..${head}`]))
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
}
