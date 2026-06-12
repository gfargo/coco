import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { SubmoduleEntry } from './submoduleData'

/**
 * Submodule maintenance actions (#0.71 — expanded git ops).
 *
 * The submodules view (#932) is a read-only inspector today; these three
 * actions let the user repair a submodule's working tree without dropping to a
 * shell. All operate on a single submodule, scoped by its repo-relative path
 * (`-- <path>`), so an action on the cursored row never disturbs its siblings.
 *
 * None are destructive — init / update / sync only register, fetch-and-check-out,
 * or rewrite the recorded remote URL; none can lose committed work — so they run
 * directly without the y-confirm gate the destructive workflows use.
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
 * `git submodule init -- <path>`: register the submodule in `.git/config` from
 * its `.gitmodules` entry. Cheap, local, idempotent — it copies the URL into the
 * parent repo's config so a later `update` knows where to fetch from. Does not
 * fetch or check anything out on its own.
 */
export function initSubmodule(git: SimpleGit, entry: SubmoduleEntry): Promise<BranchActionResult> {
  if (!entry?.path) {
    return Promise.resolve({ ok: false, message: 'No submodule selected.' })
  }
  return runAction(
    () => git.raw(['submodule', 'init', '--', entry.path]),
    `Initialized ${entry.name}`
  )
}

export type UpdateSubmoduleOptions = {
  /** `--init`: register the submodule first if it isn't already (one-shot init+update). */
  init?: boolean
}

/**
 * `git submodule update [--init] -- <path>`: fetch and check the submodule out
 * at the commit the parent repo has pinned. With `init: true` it also registers
 * the submodule first, so a single keystroke can take an uninitialized submodule
 * all the way to checked-out. Non-destructive — it only moves the submodule's
 * HEAD to the recorded pin.
 */
export function updateSubmodule(
  git: SimpleGit,
  entry: SubmoduleEntry,
  options: UpdateSubmoduleOptions = {}
): Promise<BranchActionResult> {
  if (!entry?.path) {
    return Promise.resolve({ ok: false, message: 'No submodule selected.' })
  }
  const args = ['submodule', 'update']
  if (options.init) args.push('--init')
  args.push('--', entry.path)
  return runAction(() => git.raw(args), `Updated ${entry.name}`)
}

/**
 * `git submodule sync -- <path>`: re-copy the submodule's remote URL from
 * `.gitmodules` into `.git/config` (and the submodule's own remote). The fix-up
 * when a submodule's upstream URL changed in `.gitmodules` but the local config
 * still points at the old remote. Touches only config — never the working tree.
 */
export function syncSubmodule(git: SimpleGit, entry: SubmoduleEntry): Promise<BranchActionResult> {
  if (!entry?.path) {
    return Promise.resolve({ ok: false, message: 'No submodule selected.' })
  }
  return runAction(
    () => git.raw(['submodule', 'sync', '--', entry.path]),
    `Synced ${entry.name} URL`
  )
}
