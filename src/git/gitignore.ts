/**
 * Append a pattern to the repository's `.gitignore` (the runtime side of
 * the "add to .gitignore" quick-pick, `i` on the status view).
 *
 * Kept separate from the pure pattern-derivation helper
 * (`workstation/chrome/gitignore.ts`) because this touches the filesystem
 * and resolves the repo root via git — neither of which the UI layer
 * should pull in.
 */
import { promises as fs } from 'fs'
import * as path from 'path'
import { SimpleGit } from 'simple-git'

export type GitignoreWriteResult = {
  ok: boolean
  message: string
}

/**
 * Append `pattern` to `<repoRoot>/.gitignore`, creating the file if it
 * doesn't exist. No-ops (reporting success) when the exact pattern is
 * already present so re-running is safe. Handles the missing-trailing-
 * newline case so we never glue the new entry onto the previous line.
 */
export async function addToGitignore(
  git: SimpleGit,
  pattern: string
): Promise<GitignoreWriteResult> {
  const entry = pattern.trim()
  if (!entry) {
    return { ok: false, message: 'No pattern to add.' }
  }

  let root: string
  try {
    root = (await git.revparse(['--show-toplevel'])).trim()
  } catch {
    return { ok: false, message: 'Could not resolve the repository root.' }
  }
  if (!root) {
    return { ok: false, message: 'Could not resolve the repository root.' }
  }

  const file = path.join(root, '.gitignore')
  let existing = ''
  try {
    existing = await fs.readFile(file, 'utf8')
  } catch {
    // No .gitignore yet — we'll create it.
    existing = ''
  }

  // Already ignored (exact line match, ignoring surrounding whitespace)?
  const alreadyPresent = existing
    .split('\n')
    .some((line) => line.trim() === entry)
  if (alreadyPresent) {
    return { ok: true, message: `${entry} is already in .gitignore` }
  }

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n')
  const addition = `${needsLeadingNewline ? '\n' : ''}${entry}\n`
  try {
    await fs.appendFile(file, addition, 'utf8')
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  return { ok: true, message: `Added ${entry} to .gitignore` }
}
