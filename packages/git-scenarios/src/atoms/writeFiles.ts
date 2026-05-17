import type { FileMap, Step } from './types'

/**
 * Write a map of paths → content into the working directory. Does
 * not stage. Parent directories are created automatically (the
 * underlying `TempGitRepo.writeFile` is recursive). Use when you
 * have short, literal content (README, package.json, .gitignore,
 * config files).
 *
 * For procedurally-generated content (deterministic source files
 * with realistic token counts), use `seededFiles` instead — it
 * threads a seed through the content generator so re-runs produce
 * byte-identical output.
 *
 * Compose with staging atoms to control what enters the index:
 *
 *   chain(
 *     writeFiles({ 'a.ts': '…', 'b.ts': '…' }),
 *     stageFiles('a.ts'),                  // only a.ts is staged
 *     commit('feat: add a'),               // b.ts stays in worktree
 *   )
 */
export function writeFiles(files: FileMap): Step {
  return async (repo) => {
    for (const [path, content] of Object.entries(files)) {
      await repo.writeFile(path, content)
    }
  }
}
