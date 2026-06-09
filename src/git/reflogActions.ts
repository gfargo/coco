import { SimpleGit } from 'simple-git'
import { ReflogViewEntry } from './reflogData'

/**
 * Reflog "time machine" actions (#0.67). The reflog view's whole value is
 * recovery — jumping HEAD (or a new branch) back to a previous state. Reset and
 * branch-from are handled by the shared `resetToCommit` / `createBranchFromCommit`
 * history actions (a reflog entry is just a commit by hash); the only genuinely
 * reflog-specific operation is checking out an entry, which detaches HEAD at that
 * commit so the user can inspect or recover from it.
 */
export type ReflogActionResult = {
  ok: boolean
  message: string
  details?: string[]
}

async function runAction(
  action: () => Promise<unknown>,
  successMessage: string
): Promise<ReflogActionResult> {
  try {
    await action()
    return { ok: true, message: successMessage }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Check out the commit at a reflog entry. This detaches HEAD at the entry's
 * commit (non-destructive — no refs move, no working-tree data is lost beyond a
 * normal checkout), letting the user inspect or branch off from there.
 */
export function checkoutReflogEntry(
  git: SimpleGit,
  entry: ReflogViewEntry
): Promise<ReflogActionResult> {
  if (!entry?.hash) {
    return Promise.resolve({ ok: false, message: 'No reflog entry selected.' })
  }

  return runAction(
    () => git.raw(['checkout', entry.hash]),
    `Checked out ${entry.selector} (${entry.hash}) — HEAD is now detached.`
  )
}
