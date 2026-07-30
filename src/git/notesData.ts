import { SimpleGit } from 'simple-git'

/**
 * Git notes reader (#OSS-2057).
 *
 * v1 is scoped to the default notes ref, `refs/notes/commits` — the only
 * namespace `git notes show` reads without an explicit `--ref`. Other
 * `refs/notes/*` namespaces (review notes, CI annotations, etc.) are out of
 * scope for now.
 *
 * Best-effort, mirroring `lfsAttributes.ts`: `git notes show <sha>` exits
 * non-zero both when the commit genuinely has no note AND on any other
 * failure (detached notes ref, corrupt object, not a git repo). We don't
 * distinguish those cases — every failure resolves to `undefined` so the
 * detail surface can show its empty state instead of crashing.
 */
export async function getCommitNote(git: SimpleGit, sha: string): Promise<string | undefined> {
  try {
    const output = await git.raw(['notes', 'show', sha])
    // `git notes show` appends exactly one trailing newline; strip it so
    // callers get the note body as authored.
    return output.replace(/\n$/, '')
  } catch {
    return undefined
  }
}
