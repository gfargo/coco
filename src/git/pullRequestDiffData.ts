import { defaultGhRunner, resolveGhActionError, type GhRunner } from './githubCli'

/**
 * Unified-patch fetch for a pull request by number (#1363). Backs the
 * workstation's PR-triage Enter → diff drill-in: the triage list only
 * carries metadata, so the patch is fetched lazily (and cached by the
 * runtime, bounded per repo-frame) once the user actually opens a PR.
 *
 * Same result-shape philosophy as `pullRequestActions.ts` — errors are
 * captured into `{ ok: false, message }` (via the shared gh error
 * compaction) instead of thrown, so the hydration layer can surface
 * them on the diff surface without a try/catch at every call site.
 */
export type PullRequestDiffResult =
  | { ok: true; lines: string[] }
  | { ok: false; message: string }

/**
 * `gh pr diff <n>` argv. `--color=never` keeps the patch free of ANSI
 * escapes regardless of gh's TTY detection — the workstation applies
 * its own +/- theming per line.
 */
export function buildPullRequestDiffArgs(pullRequestNumber: number): string[] {
  return ['pr', 'diff', String(pullRequestNumber), '--color=never']
}

/**
 * Split a raw patch into lines for the diff surface. A single trailing
 * newline is dropped (it would render as a phantom empty last row);
 * an empty / whitespace-only patch maps to `[]` so the surface can
 * show its "no diff" hint instead of one blank line.
 */
export function parsePullRequestDiffLines(output: string): string[] {
  if (!output.trim()) return []
  return output.replace(/\n$/, '').split('\n').map((line) => line.replace(/\r$/, ''))
}

export async function getPullRequestDiff(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestDiffResult> {
  try {
    const output = await runner(buildPullRequestDiffArgs(pullRequestNumber))
    return { ok: true, lines: parsePullRequestDiffLines(output) }
  } catch (error) {
    const { message } = await resolveGhActionError(error, runner)
    return { ok: false, message }
  }
}
