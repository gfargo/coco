import { SimpleGit } from 'simple-git'
import { getInProgressOperation } from './historyActions'
import { ReflogViewEntry, splitReflogSubject } from './reflogData'

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

/**
 * Global undo (#1361) — lazygit's `z` safety blanket. Rather than a
 * bespoke undo per operation type, this inspects the reflog tip and
 * offers its inverse:
 *
 *   - `checkout: moving from X to Y` inverts to `git checkout X` —
 *     switching back is the only sane undo for a branch move (a reset
 *     would rewrite the CURRENT branch's history, which has nothing to
 *     do with the checkout that just happened).
 *   - Everything else (commit, reset, rebase, merge, cherry-pick,
 *     revert, pull, ...) inverts to `git reset --hard HEAD@{1}` — the
 *     standard reflog-recovery move, since `HEAD@{1}` means "wherever
 *     HEAD pointed one operation ago" regardless of what that operation
 *     was.
 */
export type ReflogUndoPlan = {
  /** Human description of what will be undone, shown in the confirm panel. */
  description: string
  /** The exact command that will run, shown for transparency. */
  commandPreview: string
  /** Which inverse this is — drives `performReflogUndo`'s branch. */
  kind: 'checkout' | 'reset'
  /** Only set for `kind: 'checkout'` — the branch/ref to switch back to. */
  targetRef?: string
}

const CHECKOUT_SUBJECT_PATTERN = /^moving from (\S+) to (\S+)$/

/**
 * Inspect the reflog tip and describe the inverse of the last operation,
 * without performing it. Returns undefined when there's no reflog tip to
 * undo (empty repo, or reflog data hasn't loaded yet).
 */
export function planReflogUndo(entries: ReflogViewEntry[]): ReflogUndoPlan | undefined {
  const tip = entries[0]
  if (!tip) return undefined
  const { action, message } = splitReflogSubject(tip.subject)

  if (action === 'checkout') {
    const match = message.match(CHECKOUT_SUBJECT_PATTERN)
    if (match) {
      const [, from, to] = match
      return {
        description: `Undo checkout: switch back to '${from}' (currently on '${to}').`,
        commandPreview: `git checkout ${from}`,
        kind: 'checkout',
        targetRef: from,
      }
    }
  }

  return {
    description: `Undo ${action}${message ? ` (${message})` : ''}: reset --hard to the previous HEAD.`,
    commandPreview: 'git reset --hard HEAD@{1}',
    kind: 'reset',
  }
}

/**
 * Perform the inverse operation described by `plan`. Callers should
 * re-derive `plan` from a fresh reflog read immediately before calling
 * this — the reflog can move between when the user pressed the undo key
 * and when they confirmed it.
 */
export async function performReflogUndo(
  git: SimpleGit,
  plan: ReflogUndoPlan
): Promise<ReflogActionResult> {
  if (plan.kind === 'checkout' && plan.targetRef) {
    return runAction(
      () => git.raw(['checkout', plan.targetRef as string]),
      `Switched back to '${plan.targetRef}'.`
    )
  }
  // reset --hard mid-rebase/merge/cherry-pick moves HEAD without cleaning
  // up the operation's state files (.git/rebase-merge, MERGE_HEAD, ...),
  // leaving the repo in a confusing half-finished state — same hazard
  // `resetToCommit` guards against, so undo refuses the same way rather
  // than silently making it worse.
  const inProgress = await getInProgressOperation(git)
  if (inProgress) {
    return { ok: false, message: `Finish or abort the in-progress ${inProgress} before undoing.` }
  }
  return runAction(
    () => git.raw(['reset', '--hard', 'HEAD@{1}']),
    'Reset to the previous HEAD (HEAD@{1}).'
  )
}
