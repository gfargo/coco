import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { rejectFlagLike } from './forgeArgGuards'

/**
 * Non-interactive rebase actions (#0.71 — expanded git ops).
 *
 * `rebaseOnto` rebases the current branch onto a selected branch/ref —
 * the non-interactive counterpart to the `interactive-rebase` flow in
 * `historyActions.ts` (which shells `git rebase -i` into $GIT_EDITOR).
 * This one runs `git rebase <ref>` with NO `-i`, so it never opens an
 * editor and can run unattended from the branches view.
 *
 * On a clean replay the command exits zero → `{ ok:true }`. On a
 * conflict (or any other failure) git exits non-zero and we return
 * `{ ok:false, message }` carrying git's own message. In the conflict
 * case the repo is left mid-rebase; the existing in-progress-operation
 * surfaces (`getGitOperationOverview`, the `gx` conflicts view, and the
 * `A` abort-operation action) reflect and unwind that state — this
 * action deliberately does NOT add `--continue` / `--abort` paths.
 *
 * The `ref` is validated with `rejectFlagLike` so a value beginning with
 * `-` can't be misparsed by git as a flag. argv is passed via
 * simple-git's execFile (no shell), so there's no command injection —
 * this is defense-in-depth against a leading-`-` ref flipping a flag.
 */

async function runAction(
  action: () => Promise<unknown>,
  successMessage: string
): Promise<BranchActionResult> {
  try {
    await action()
    return { ok: true, message: successMessage }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * `git rebase <ref>`: replay the current branch's commits on top of
 * `<ref>`. Non-interactive — no `-i`, so $GIT_EDITOR is never opened.
 * Validates the ref up front so a flag-like value never reaches argv.
 */
export function rebaseOnto(git: SimpleGit, ref: string): Promise<BranchActionResult> {
  const trimmed = ref.trim()
  if (!trimmed) {
    return Promise.resolve({ ok: false, message: 'Rebase target ref required.' })
  }
  const flagError = rejectFlagLike(trimmed, `Rebase target '${trimmed}'`)
  if (flagError) {
    return Promise.resolve({ ok: false, message: flagError })
  }
  return runAction(
    () => git.raw(['rebase', trimmed]),
    `Rebased onto ${trimmed}`
  )
}
