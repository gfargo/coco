import { mkdir, writeFile as writeFileFs } from 'fs/promises'
import { dirname, join } from 'path'
import { simpleGit } from 'simple-git'
import type { TempGitRepo } from '../tempGitRepo'
import type { Step } from './types'

/**
 * Run a step on a named branch, then restore the previous branch.
 * Sugar over `checkoutBranch(name) → step → checkoutBranch(previous)`.
 *
 *   onBranch('feat/x', chain(
 *     addCommit({ message: 'wip', files: { 'src/x.ts': '…' } }),
 *   ))
 *
 * The pre-step branch is captured at run time, so this composes
 * cleanly inside `repeat()` or other dynamic contexts. If the repo
 * is in detached-HEAD state, the restore step is a no-op (which
 * matches what `git checkout -` would do).
 *
 * The atom does NOT create the branch — pair with `createBranch` or
 * `switchToBranch` if the target doesn't exist yet:
 *
 *   chain(
 *     createBranch('feat/x'),                 // creates feat/x at HEAD, doesn't switch
 *     onBranch('feat/x', addCommit({ … })),   // runs on feat/x, returns to wherever we were
 *   )
 */
export function onBranch(name: string, step: Step): Step {
  return async (repo) => {
    const status = await repo.git.status()
    const previous = status.current
    await repo.git.checkout(name)
    try {
      await step(repo)
    } finally {
      if (previous && previous !== name) {
        await repo.git.checkout(previous)
      }
    }
  }
}

/**
 * Run any step against a submodule's working tree. The submodule is
 * presented to the step as a `TempGitRepo`-shaped object bound to
 * the submodule's path, so every atom in this package — `addCommit`,
 * `switchToBranch`, `seededFiles`, even nested `addSubmodule` — works
 * inside.
 *
 *   chain(
 *     addSubmodule({ path: 'vendor/lib', setup: chain(…) }),
 *     addCommit({ message: 'chore: add submodule' }),
 *     // Now make a commit inside the submodule that DOESN'T update
 *     // the parent's pin — produces the "out of date submodule" state
 *     // where the parent points at an older sha.
 *     insideSubmodule('vendor/lib', chain(
 *       addCommit({ message: 'feat: post-pin change', files: { … } }),
 *     )),
 *   )
 *
 * The wrapped repo's `cleanup` is a no-op — the submodule's lifetime
 * is owned by the parent. Calling cleanup on the parent removes the
 * submodule clone too.
 */
export function insideSubmodule(submodulePath: string, step: Step): Step {
  return async (parentRepo) => {
    const submoduleRoot = join(parentRepo.path, submodulePath)
    const submoduleGit = simpleGit(submoduleRoot)
    const submoduleRepo: TempGitRepo = {
      path: submoduleRoot,
      git: submoduleGit,
      writeFile: async (filePath, content) => {
        const abs = join(submoduleRoot, filePath)
        await mkdir(dirname(abs), { recursive: true })
        await writeFileFs(abs, content)
      },
      commitAll: async (message) => {
        await submoduleGit.add('.')
        await submoduleGit.commit(message)
      },
      cleanup: async () => {
        // No-op: the parent's cleanup removes the submodule clone too.
      },
    }
    await step(submoduleRepo)
  }
}
