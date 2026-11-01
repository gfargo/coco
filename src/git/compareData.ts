import { SimpleGit } from 'simple-git'
import { MACHINE_DIFF_ARGS } from './machineDiff'

/**
 * Compare two refs (branches / tags / commits) and return the unified
 * patch as line-split string output (#779).
 *
 * Mirrors the stash-diff loader's contract — emits `string[]` so the
 * existing diff surface can render the lines through its standard
 * +/-/@@ coloring path. Three-dot syntax (`base...head`) diffs from the
 * merge base to head, which is "what this branch adds" and matches what a
 * pull request shows. Two-dot also folds in whatever landed on base since
 * the branches diverged, so a branch that is simply behind looked like it
 * was reverting that work.
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
  return (await git.raw(['diff', ...MACHINE_DIFF_ARGS, `${base}...${head}`]))
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
}

/** Most head-only commits listed in the compare header. */
export const COMPARE_COMMIT_LIMIT = 50

export type CompareSummary = {
  /** Commits on head that base does not have. */
  ahead: number
  /** Commits on base that head does not have. */
  behind: number
  /** The common ancestor the diff starts from; absent for unrelated histories. */
  mergeBase?: string
  /** Head-only commits, newest first, capped at {@link COMPARE_COMMIT_LIMIT}. */
  commits: Array<{ hash: string; subject: string }>
}

/**
 * Counts and commit list for a three-dot comparison (#2214). `ahead`/`behind`
 * come from `rev-list --left-right --count`, whose left side is base-only.
 * A missing merge base (unrelated histories) is not an error.
 */
export async function getCompareSummary(
  git: SimpleGit,
  base: string,
  head: string
): Promise<CompareSummary> {
  const [counts, log, mergeBase] = await Promise.all([
    git.raw(['rev-list', '--left-right', '--count', `${base}...${head}`]),
    git.raw(['log', `--max-count=${COMPARE_COMMIT_LIMIT}`, '--format=%h%x1f%s', `${base}..${head}`]),
    git.raw(['merge-base', base, head]).catch(() => ''),
  ])
  const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map((n) => Number.parseInt(n, 10) || 0)
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ''] = line.split('\x1f')
      return { hash, subject }
    })
  const trimmedBase = mergeBase.trim()
  return { ahead, behind, mergeBase: trimmedBase ? trimmedBase.slice(0, 7) : undefined, commits }
}
