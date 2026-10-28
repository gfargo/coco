import * as path from 'node:path'
import type { SimpleGit } from 'simple-git'

type RevParse = (args: string[]) => Promise<string>

/**
 * Resolve a `git rev-parse` path answer (`--git-path <name>`,
 * `--git-common-dir`, ...) to an absolute path (#2205).
 *
 * Those answers are RELATIVE to the directory git ran in (the SimpleGit
 * instance's base dir), but callers then ran `existsSync` on them, which
 * resolves against `process.cwd()`. In a nested repo frame (a submodule
 * drilled into from the root repo) those are different repos, so
 * "is a merge in progress?" was answered for the wrong one. Appending
 * `--show-toplevel --show-prefix` to the same call gives the instance's
 * own cwd (toplevel + prefix), which is the correct base.
 * (`--path-format=absolute` would do this directly but needs git 2.31; the
 * supported minimum is 2.24.)
 *
 * Output is `<answer>\n<toplevel>[\n<prefix>]`: an empty prefix (repo
 * root) is trimmed away with the trailing newline, so two lines means
 * "at the root". A bare single line (an already-absolute answer, or the
 * shape older fakes return) resolves against `process.cwd()`, the
 * previous behaviour.
 */
export async function resolveRevParsePath(
  git: SimpleGit,
  args: string[],
  run: RevParse = (a) => git.revparse(a)
): Promise<string> {
  let output: string
  try {
    output = await run([...args, '--show-toplevel', '--show-prefix'])
  } catch {
    // e.g. --show-toplevel fails in a bare repo; fall back to the bare question.
    output = await run(args)
  }
  const lines = output.split('\n').map((line) => line.replace(/\r$/, ''))
  const value = (lines[0] ?? '').trim()
  if (!value) return ''
  if (path.isAbsolute(value)) return value
  if (lines.length >= 2) {
    const toplevel = (lines[1] ?? '').trim()
    const prefix = (lines[2] ?? '').trim()
    return path.resolve(path.join(toplevel, prefix), value)
  }
  return path.resolve(value)
}

export function resolveGitPath(git: SimpleGit, name: string, run?: RevParse): Promise<string> {
  return resolveRevParsePath(git, ['--git-path', name], run)
}
