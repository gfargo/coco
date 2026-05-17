import { mkdir, writeFile as writeFileFs } from 'fs/promises'
import { dirname, join } from 'path'
import { simpleGit } from 'simple-git'
import type { TempGitRepo } from '../tempGitRepo'
import type { Step } from './types'

/**
 * Author identity for the `withAuthor` scope. All four fields land
 * in the wrapped scope's env vars (`GIT_AUTHOR_*` /
 * `GIT_COMMITTER_*`); `date` is optional and pins both author and
 * committer dates the same way `addCommit({ date })` does.
 */
export type AuthorIdentity = {
  name: string
  email: string
  date?: string
}

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
/**
 * Run a step with a specific author identity. Any commit-producing
 * atom inside the step (`addCommit`, `commit`, `emptyCommit`,
 * `amendCommit`, `cherryPick`, `revert`, `startMerge`) attributes
 * to the named author/email/(date) via the standard `GIT_AUTHOR_*`
 * + `GIT_COMMITTER_*` env vars.
 *
 *   withAuthor({ name: 'Alice', email: 'alice@example.com' }, chain(
 *     addCommit({ message: 'feat: alice work', files: { 'a.ts': '…' } }),
 *   ))
 *
 *   // Multi-contributor history:
 *   chain(
 *     withAuthor({ name: 'Alice', email: 'alice@x' }, addCommit({ message: 'feat: a' })),
 *     withAuthor({ name: 'Bob', email: 'bob@x' }, addCommit({ message: 'fix: b' })),
 *   )
 *
 * **Footgun**: simple-git's `env()` replaces (doesn't merge) env
 * vars. If an atom inside `withAuthor` also specifies its own
 * `date`, that atom's env override will clobber the author env for
 * that one command. To pin a date *and* author together, pass the
 * date into `withAuthor`:
 *
 *   withAuthor(
 *     { name: 'Alice', email: 'alice@x', date: daysAgo(30) },
 *     addCommit({ message: 'feat: a' }),   // no `date` here
 *   )
 *
 * The wrapped repo's `cleanup` is a no-op — the underlying repo is
 * owned by the caller; this scope only swaps the git instance for
 * the duration of `step`.
 */
export function withAuthor(identity: AuthorIdentity, step: Step): Step {
  return async (repo) => {
    const env: Record<string, string> = {
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    }
    if (identity.date) {
      env.GIT_AUTHOR_DATE = identity.date
      env.GIT_COMMITTER_DATE = identity.date
    }
    // simple-git's `env()` MUTATES the receiver instance — chaining
    // `repo.git.env(...)` would leak the override outside this scope.
    // Build a fresh SimpleGit bound to the same workdir so the
    // original `repo.git` stays untouched.
    const scopedGit = simpleGit(repo.path).env(env)
    const scopedRepo: TempGitRepo = {
      path: repo.path,
      git: scopedGit,
      writeFile: repo.writeFile,
      commitAll: async (message) => {
        await scopedGit.add('.')
        await scopedGit.commit(message)
      },
      cleanup: async () => {
        // No-op: the parent's cleanup owns the actual repo.
      },
    }
    await step(scopedRepo)
  }
}

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
