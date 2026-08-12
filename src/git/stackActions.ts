import { SimpleGit } from 'simple-git'
import { BranchActionResult, createBranch } from './branchActions'
import { rejectFlagLike } from './forgeArgGuards'

const PARENT_KEY = (branch: string) => `branch.${branch}.coco-parent`

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()
    return { ok: true, message: successMessage }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/** Record `parent` as `branch`'s stack parent via `git config`. */
export function setStackParent(
  git: SimpleGit,
  branch: string,
  parent: string
): Promise<BranchActionResult> {
  const branchError = rejectFlagLike(branch, `Branch name '${branch}'`)
  if (branchError) return Promise.resolve({ ok: false, message: branchError })

  const parentError = rejectFlagLike(parent, `Parent branch '${parent}'`)
  if (parentError) return Promise.resolve({ ok: false, message: parentError })

  return runAction(
    () => git.raw(['config', PARENT_KEY(branch), parent]),
    `Set stack parent of ${branch} to ${parent}`
  )
}

/**
 * Unset `branch`'s stack parent. `git config --unset` exits non-zero when
 * the key is already absent — treated as success here so clearing an
 * already-clear pointer is idempotent rather than an error.
 */
export function clearStackParent(git: SimpleGit, branch: string): Promise<BranchActionResult> {
  const branchError = rejectFlagLike(branch, `Branch name '${branch}'`)
  if (branchError) return Promise.resolve({ ok: false, message: branchError })

  return runAction(async () => {
    try {
      await git.raw(['config', '--unset', PARENT_KEY(branch)])
    } catch {
      // Already unset — nothing to do.
    }
  }, `Cleared stack parent of ${branch}`)
}

/**
 * Create a new branch off `parent` and record the stacking relationship in
 * one step: `createBranch` (which already validates `name`) followed by
 * `setStackParent`.
 */
export async function createStackedBranch(
  git: SimpleGit,
  name: string,
  parent: string
): Promise<BranchActionResult> {
  const nameError = rejectFlagLike(name, `Branch name '${name}'`)
  if (nameError) return { ok: false, message: nameError }

  const parentError = rejectFlagLike(parent, `Parent branch '${parent}'`)
  if (parentError) return { ok: false, message: parentError }

  const created = await createBranch(git, name, parent)
  if (!created.ok) return created

  const linked = await setStackParent(git, name, parent)
  if (!linked.ok) return linked

  return { ok: true, message: `Created ${name} stacked on ${parent}` }
}
