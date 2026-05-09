import { SimpleGit } from 'simple-git'

/**
 * Thin wrappers around `git bisect <verb>` for the TUI's in-bisect
 * action keys (#784). Each returns the raw stdout so the surface can
 * surface git's own "Bisecting: N revisions left to test after this
 * (roughly K steps)" hint as a status message — that wording is the
 * single most useful piece of feedback git emits during bisect, and
 * mirroring it keeps the TUI's status line authoritative.
 *
 * No try/catch here — git itself returns non-zero on user errors
 * (already-bisecting, no good ref, etc.) and `simple-git` surfaces
 * those as rejections. The runtime catches them and routes to the
 * status line.
 */

export async function bisectStart(
  git: SimpleGit,
  badRef: string,
  goodRef: string
): Promise<string> {
  return git.raw(['bisect', 'start', badRef, goodRef])
}

export async function bisectGood(git: SimpleGit, ref?: string): Promise<string> {
  const args = ['bisect', 'good']
  if (ref) args.push(ref)
  return git.raw(args)
}

export async function bisectBad(git: SimpleGit, ref?: string): Promise<string> {
  const args = ['bisect', 'bad']
  if (ref) args.push(ref)
  return git.raw(args)
}

export async function bisectSkip(git: SimpleGit, ref?: string): Promise<string> {
  const args = ['bisect', 'skip']
  if (ref) args.push(ref)
  return git.raw(args)
}

export async function bisectReset(git: SimpleGit): Promise<string> {
  return git.raw(['bisect', 'reset'])
}

/**
 * Pull the user-facing remaining-revisions hint out of `git bisect`
 * stdout. Looks for the canonical line:
 *
 *   `Bisecting: N revisions left to test after this (roughly K steps)`
 *
 * Returns undefined when the line isn't present (e.g. the run
 * finished and git emitted a "<sha> is the first bad commit" line
 * instead). Callers fall back to an empty status update in that case.
 */
export function extractBisectRemainingHint(stdout: string): string | undefined {
  for (const line of stdout.split('\n').reverse()) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Bisecting:')) return trimmed
    if (trimmed.includes('is the first bad commit')) return trimmed
  }
  return undefined
}
