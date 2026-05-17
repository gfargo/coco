import type { Step } from './types'

/**
 * Attempt a merge of `branch` into the current branch. With
 * `allowConflict: true` (the **default**), the atom swallows the
 * "merge has conflicts" error and leaves the repo in a conflicted
 * state — what most scenarios actually want when staging a conflict
 * workflow. With `allowConflict: false`, the atom rethrows any merge
 * error, including conflicts.
 *
 * Typical conflict-staging pattern:
 *
 *   chain(
 *     addCommit({ message: 'base', files: { 'src/x.ts': BASE } }),
 *     switchToBranch('feat/theirs'),
 *     addCommit({ message: 'theirs', files: { 'src/x.ts': THEIRS } }),
 *     checkoutBranch('main'),
 *     addCommit({ message: 'ours', files: { 'src/x.ts': OURS } }),
 *     startMerge('feat/theirs'),
 *     // repo is now mid-merge with src/x.ts conflicted
 *   )
 */
export function startMerge(
  branch: string,
  options: { allowConflict?: boolean; noFastForward?: boolean; date?: string; message?: string } = {},
): Step {
  const allowConflict = options.allowConflict !== false
  return async (repo) => {
    const args = ['merge', '--no-edit']
    if (options.noFastForward) {
      args.push('--no-ff')
    }
    if (options.message) {
      args.push('-m', options.message)
    }
    args.push(branch)
    const gitInstance = options.date
      ? repo.git.env({
          GIT_AUTHOR_DATE: options.date,
          GIT_COMMITTER_DATE: options.date,
        })
      : repo.git

    let mergeError: unknown
    try {
      await gitInstance.raw(args)
    } catch (error) {
      mergeError = error
    }

    // simple-git's behavior on `merge` conflicts varies by task plugin
    // / version (sometimes throws, sometimes resolves with the conflict
    // summary on the response). Trust the worktree status instead of
    // the throw: if files are conflicted, we have a conflict — regardless
    // of whether raw rejected.
    const status = await repo.git.status()
    if (status.conflicted.length > 0) {
      if (!allowConflict) {
        throw mergeError ?? new Error(
          `merge of '${branch}' produced conflicts: ${status.conflicted.join(', ')}`,
        )
      }
      return // leave the repo in mid-merge state
    }
    if (mergeError) {
      // No conflicts but merge still failed — surface the original error.
      throw mergeError
    }
  }
}

/**
 * Abort an in-progress merge (`git merge --abort`). Restores the
 * working tree and index to pre-merge state. Useful for testing
 * "user backed out of the conflict" flows.
 */
export function abortMerge(): Step {
  return async (repo) => {
    await repo.git.raw(['merge', '--abort'])
  }
}

/**
 * Start a bisect session (`git bisect start <bad> <good>`). Leaves
 * the repo in active-bisect state, with HEAD at the first candidate
 * commit. Pair with `bisectStep` to drive the binary search forward.
 *
 *   chain(
 *     // ... N commits on main ...
 *     startBisect({ bad: 'main', good: 'HEAD~10' }),
 *     bisectStep('good'),
 *     bisectStep('bad'),
 *     // ... etc until git pins the regression ...
 *   )
 */
export function startBisect(options: { bad: string; good: string }): Step {
  return async (repo) => {
    await repo.git.raw(['bisect', 'start', options.bad, options.good])
  }
}

/**
 * Mark the current bisect candidate (`git bisect good` / `bad` /
 * `skip`). Advances the search; if git narrows to a single commit
 * the bisect concludes and HEAD points at the first bad commit.
 */
export function bisectStep(verdict: 'good' | 'bad' | 'skip'): Step {
  return async (repo) => {
    await repo.git.raw(['bisect', verdict])
  }
}

/**
 * End the bisect session (`git bisect reset`). Returns HEAD to the
 * pre-bisect branch tip.
 */
export function resetBisect(): Step {
  return async (repo) => {
    await repo.git.raw(['bisect', 'reset'])
  }
}

/**
 * Reset to a target ref (`git reset --<mode> <target>`).
 *
 *   - `'soft'`   — moves HEAD; index + worktree unchanged (staged for re-commit)
 *   - `'mixed'`  — moves HEAD; resets index; worktree unchanged (default)
 *   - `'hard'`   — moves HEAD; resets index + worktree
 *
 * Use `resetTo({ target: 'HEAD~1', mode: 'hard' })` to drop the last
 * commit and any worktree changes — the canonical "undo a commit"
 * test fixture.
 */
export function resetTo(options: { target: string; mode?: 'soft' | 'mixed' | 'hard' }): Step {
  const mode = options.mode ?? 'mixed'
  return async (repo) => {
    await repo.git.raw(['reset', `--${mode}`, options.target])
  }
}

/**
 * Cherry-pick a commit onto the current branch (`git cherry-pick
 * <sha>`). With `allowConflict: true` (the **default**), conflicts
 * leave the repo mid-cherry-pick with `CHERRY_PICK_HEAD` set and
 * conflicted files in the worktree — exactly the shape conflicts-
 * view scenarios want. With `allowConflict: false`, the atom rethrows
 * on any failure.
 *
 *   chain(
 *     addCommit({ message: 'base', files: { 'x.ts': BASE } }),
 *     switchToBranch('feat/source'),
 *     addCommit({ message: 'pickable', files: { 'y.ts': 'y' } }),
 *     checkoutBranch('main'),
 *     cherryPick('feat/source'),   // ref or sha; cherry-picks the pickable commit
 *   )
 *
 * Pass `date` to pin the cherry-pick's author + committer dates
 * (same env mechanism as `addCommit`).
 */
export function cherryPick(
  ref: string,
  options: { allowConflict?: boolean; date?: string } = {},
): Step {
  const allowConflict = options.allowConflict !== false
  return async (repo) => {
    const gitInstance = options.date
      ? repo.git.env({
          GIT_AUTHOR_DATE: options.date,
          GIT_COMMITTER_DATE: options.date,
        })
      : repo.git

    let cherryError: unknown
    try {
      await gitInstance.raw(['cherry-pick', ref])
    } catch (error) {
      cherryError = error
    }
    const status = await repo.git.status()
    if (status.conflicted.length > 0) {
      if (!allowConflict) {
        throw cherryError ?? new Error(
          `cherry-pick of '${ref}' produced conflicts: ${status.conflicted.join(', ')}`,
        )
      }
      return // leave the repo mid-cherry-pick
    }
    if (cherryError) {
      throw cherryError
    }
  }
}

/**
 * Abort an in-progress cherry-pick (`git cherry-pick --abort`).
 * Restores the working tree to pre-cherry-pick state.
 */
export function abortCherryPick(): Step {
  return async (repo) => {
    await repo.git.raw(['cherry-pick', '--abort'])
  }
}

/**
 * Revert a commit (`git revert --no-edit <sha>`). Produces a new
 * commit that undoes the named commit's changes.
 *
 *   revert('abc1234')                          // revert a regular commit
 *   revert('merge-sha', { mainline: 1 })       // revert a merge commit
 *
 * Reverting a merge commit requires the `mainline` option to tell
 * git which parent is the "mainline" (the branch the merge stayed
 * on). `mainline: 1` is the common case (the branch the merge was
 * made INTO).
 *
 * With `allowConflict: true` (default), conflicts leave the repo
 * mid-revert with `REVERT_HEAD` set. With `allowConflict: false`,
 * any failure rethrows.
 */
export function revert(
  ref: string,
  options: { mainline?: number; allowConflict?: boolean; date?: string } = {},
): Step {
  const allowConflict = options.allowConflict !== false
  return async (repo) => {
    const args = ['revert', '--no-edit']
    if (options.mainline) {
      args.push('-m', String(options.mainline))
    }
    args.push(ref)
    const gitInstance = options.date
      ? repo.git.env({
          GIT_AUTHOR_DATE: options.date,
          GIT_COMMITTER_DATE: options.date,
        })
      : repo.git

    let revertError: unknown
    try {
      await gitInstance.raw(args)
    } catch (error) {
      revertError = error
    }
    const status = await repo.git.status()
    if (status.conflicted.length > 0) {
      if (!allowConflict) {
        throw revertError ?? new Error(
          `revert of '${ref}' produced conflicts: ${status.conflicted.join(', ')}`,
        )
      }
      return
    }
    if (revertError) {
      throw revertError
    }
  }
}

/**
 * Commit with `--allow-empty` so an absent diff doesn't error
 * (`git commit --allow-empty -m <message>`). Useful for setting up
 * "history with N entries" scenarios where the diff content doesn't
 * matter — saves the overhead of generating throwaway content for
 * each step.
 *
 * Pass `date` to pin author + committer dates (see `addCommit`).
 */
export function emptyCommit(message: string, options: { date?: string } = {}): Step {
  return async (repo) => {
    const gitInstance = options.date
      ? repo.git.env({
          GIT_AUTHOR_DATE: options.date,
          GIT_COMMITTER_DATE: options.date,
        })
      : repo.git
    await gitInstance.raw(['commit', '--allow-empty', '-m', message])
  }
}

/**
 * Amend the current commit (`git commit --amend`). With `message`,
 * rewrites the commit subject + body; without, keeps the existing
 * message (`--no-edit`).
 *
 * Uses `--all` so modifications to **already-tracked** files fold
 * into the amended commit automatically. New untracked files do
 * NOT get picked up by `--all` — stage them explicitly first if you
 * want them included:
 *
 *   chain(
 *     writeFiles({ 'src/new.ts': '…' }),
 *     stageFiles('src/new.ts'),
 *     amendCommit({ message: 'feat: with new file' }),
 *   )
 */
export function amendCommit(options: { message?: string } = {}): Step {
  return async (repo) => {
    const args = ['commit', '--amend', '--all']
    if (options.message) {
      args.push('-m', options.message)
    } else {
      args.push('--no-edit')
    }
    await repo.git.raw(args)
  }
}
