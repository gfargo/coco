import { execFile } from 'child_process'
import { promisify } from 'util'

/**
 * Runs `git` directly (not through simple-git) with an explicit
 * environment. Needed for the few operations that must override git's
 * editors: simple-git refuses `-c core.editor=...` / `-c sequence.editor=...`
 * and a caller-supplied `GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` without its
 * `allowUnsafeEditor` opt-in, and opting in would also let a hostile repo
 * config through. The environment variable form scoped to one child process
 * is the supported way (see `executeRebasePlan`, `continueOperation`).
 */
export type GitProcessRunner = (
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
) => Promise<unknown>

export const runGitProcess: GitProcessRunner = async (args, options) => {
  try {
    // Promisified per call, not at module load: importers' tests mock
    // `child_process` wholesale.
    return await promisify(execFile)('git', args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    // execFile errors lead with the echoed command line. Surface git's own
    // output instead: stderr first (its complaint), then stdout (where git
    // prints `CONFLICT (content): ...` lines).
    const { stderr, stdout } = error as { stderr?: string; stdout?: string }
    const output = [stderr, stdout].filter((part) => typeof part === 'string' && part.trim()).join('\n')
    if (output) {
      throw new Error(output)
    }
    throw error
  }
}
