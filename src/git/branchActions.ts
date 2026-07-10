import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'
import { rejectFlagLike } from './forgeArgGuards'

export type BranchActionResult = {
  ok: boolean
  message: string
  details?: string[]
}

function localNameFromRemote(remoteBranch: string): string {
  const [, ...parts] = remoteBranch.split('/')
  return parts.join('/') || remoteBranch
}

export function getBranchActionRefs(branch: BranchRef): {
  localBranch: string
  remoteBranch?: string
} {
  if (branch.type === 'remote') {
    return {
      localBranch: localNameFromRemote(branch.shortName),
      remoteBranch: branch.shortName,
    }
  }

  return {
    localBranch: branch.shortName,
    remoteBranch: branch.upstream,
  }
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

/** Configured remote names (best-effort; `[]` if the call fails). */
async function listRemotes(git: SimpleGit): Promise<string[]> {
  try {
    return (await git.getRemotes()).map((remote) => remote.name).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Remote to push a not-yet-tracked branch to: `origin` when it exists,
 * else the first configured remote, else `undefined` (no remotes).
 */
async function resolveDefaultRemote(git: SimpleGit): Promise<string | undefined> {
  const remotes = await listRemotes(git)
  if (remotes.length === 0) return undefined
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

/** Whether the remote-tracking ref `refs/remotes/<remote>/<branch>` exists locally. */
async function remoteBranchExists(git: SimpleGit, remote: string, branch: string): Promise<boolean> {
  try {
    await git.raw(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`])
    return true
  } catch {
    return false
  }
}

export function checkoutBranch(git: SimpleGit, branch: BranchRef): Promise<BranchActionResult> {
  const refs = getBranchActionRefs(branch)

  if (branch.type === 'remote') {
    return runAction(
      () => git.raw(['switch', '--track', '-c', refs.localBranch, refs.remoteBranch as string]),
      `Created tracking branch ${refs.localBranch} from ${refs.remoteBranch}`
    )
  }

  return runAction(
    () => git.raw(['switch', refs.localBranch]),
    `Checked out ${refs.localBranch}`
  )
}

export function createBranch(
  git: SimpleGit,
  branchName: string,
  startPoint: string
): Promise<BranchActionResult> {
  // Use `git branch` (not `git switch -c`) so the new branch is created
  // without switching onto it. The workstation then prompts the user with
  // a Y/n overlay asking whether to check it out, matching the
  // create-branch-here behavior (#1326).
  const nameError = rejectFlagLike(branchName, `Branch name '${branchName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['branch', branchName, startPoint]),
    `Created branch ${branchName} from ${startPoint}`
  )
}

/**
 * Switch to an existing local branch by name. Used as the follow-up action
 * after `create-branch-here` (which creates the branch without switching) when
 * the user confirms the checkout prompt.
 */
export function checkoutBranchByName(git: SimpleGit, name: string): Promise<BranchActionResult> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve({ ok: false, message: 'Branch name required' })
  return runAction(() => git.raw(['switch', trimmed]), `Checked out ${trimmed}`)
}

export function renameBranch(
  git: SimpleGit,
  oldName: string,
  newName: string
): Promise<BranchActionResult> {
  const nameError = rejectFlagLike(newName, `Branch name '${newName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['branch', '-m', oldName, newName]),
    `Renamed ${oldName} to ${newName}`
  )
}

export function deleteBranch(
  git: SimpleGit,
  branch: BranchRef,
  force = false
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return Promise.resolve({
      ok: false,
      message: 'Only local branches can be deleted.',
    })
  }

  if (branch.current) {
    return Promise.resolve({
      ok: false,
      message: 'Cannot delete the current branch.',
    })
  }

  // `-d` is the safe delete (refuses unmerged branches); `-D` forces it.
  // The TUI starts with `-d` and only escalates to `-D` after the user
  // confirms a second time on the "not fully merged" error.
  return runAction(
    () => git.raw(['branch', force ? '-D' : '-d', branch.shortName]),
    force ? `Force-deleted branch ${branch.shortName}` : `Deleted branch ${branch.shortName}`
  )
}

/**
 * Delete several branches sequentially (#1361 batch delete). Continues
 * past per-branch refusals — `-d`'s not-fully-merged guard, the
 * current-branch guard, worktree-checkout refusals — and reports a
 * summary. Per-branch failure messages ride in `details` verbatim, so
 * the caller's not-fully-merged detection (for the force-delete
 * escalation) keeps matching git's raw wording.
 */
export async function deleteBranches(
  git: SimpleGit,
  branches: BranchRef[],
  force = false
): Promise<BranchActionResult> {
  if (branches.length === 0) {
    return { ok: false, message: 'No branches selected.' }
  }
  if (branches.length === 1) {
    return deleteBranch(git, branches[0], force)
  }

  const deleted: string[] = []
  const failures: string[] = []
  for (const branch of branches) {
    const result = await deleteBranch(git, branch, force)
    if (result.ok) {
      deleted.push(branch.shortName)
    } else {
      failures.push(`${branch.shortName}: ${result.message}`)
    }
  }

  if (failures.length === 0) {
    const verb = force ? 'Force-deleted' : 'Deleted'
    return { ok: true, message: `${verb} ${deleted.length} branches: ${deleted.join(', ')}` }
  }
  return {
    ok: false,
    message: `Deleted ${deleted.length} of ${branches.length} branches — ${failures.length} refused`,
    details: failures,
  }
}

/**
 * True when a failed `git branch -d` was rejected specifically because the
 * branch isn't fully merged (the one case worth offering a force-delete
 * for). Matches git's wording across versions ("not fully merged").
 */
export function isBranchNotFullyMergedError(message: string | undefined): boolean {
  return /not fully merged/i.test(message || '')
}

/**
 * True when a branch delete was rejected because the branch is checked
 * out in a worktree. Unlike "not fully merged" there's no force escape
 * hatch — git refuses `git branch -D` on a worktree-checked-out branch
 * too — so the UI should surface a clear "free up the worktree first"
 * message rather than offering a force-delete that would fail the same
 * way. Matches git's wording: `Cannot delete branch 'x' checked out at
 * '<path>'` / `used by worktree at '<path>'`.
 */
export function isBranchCheckedOutElsewhereError(message: string | undefined): boolean {
  return /checked out at|used by worktree/i.test(message || '')
}

/**
 * True when a checkout / switch was refused because uncommitted local
 * changes (tracked or untracked) would be overwritten. Matches git's
 * wording across versions and both entry commands: "Your local changes
 * to the following files would be overwritten by checkout" / "The
 * following untracked working tree files would be overwritten by
 * checkout" (and the `git switch` phrasing). Deliberately narrower than
 * a generic dirty-tree check — the merge-flavored "overwritten by
 * merge" rejection routes through the pull recovery flows instead
 * (#1360).
 */
export function isDirtyWorktreeCheckoutError(message: string | undefined): boolean {
  return /would be overwritten by (checkout|switch)/i.test(message || '')
}

/**
 * Pull the worktree path out of git's "checked out at '<path>'" /
 * "used by worktree at '<path>'" rejection so the UI can name where the
 * branch is still in use. Returns undefined when the message doesn't
 * carry a path (older git phrasings) so callers can fall back to a
 * generic message.
 */
export function parseCheckedOutWorktreePath(message: string | undefined): string | undefined {
  const match = /(?:checked out at|used by worktree at) '([^']+)'/i.exec(message || '')
  return match?.[1]
}

/**
 * True when a push was rejected because the remote moved (non-fast-
 * forward). Matches git's phrasings across versions: "non-fast-forward",
 * "fetch first", "stale info" (force-with-lease refusal), and the
 * summary "failed to push some refs". Callers join message + details
 * before testing — runAction splits the error across both.
 */
export function isNonFastForwardPushError(message: string | undefined): boolean {
  return /non-fast-forward|fetch first|stale info|failed to push some refs/i.test(message || '')
}

/**
 * True when `pull --ff-only` refused because local and remote diverged.
 * Deliberately does NOT match the bare "non-fast-forward" fetch-refspec
 * rejection (non-current-branch pulls) — the rebase/merge recovery
 * choice only makes sense for the checked-out branch.
 */
export function isDivergedPullError(message: string | undefined): boolean {
  return /not possible to fast-forward|have diverged/i.test(message || '')
}

/**
 * `push --force-with-lease` for the current branch — the recovery path
 * offered when an ordinary push is rejected non-fast-forward after an
 * amend / rebase / autosquash. With-lease refuses to clobber remote
 * commits that arrived since the last fetch, unlike bare --force.
 */
export function forcePushCurrentBranch(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['push', '--force-with-lease']),
    'Force-pushed current branch (with lease)'
  )
}

/** See {@link forcePushCurrentBranch} — the cursored-branch variant. */
export function forcePushBranch(
  git: SimpleGit,
  branch: BranchRef
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return Promise.resolve({ ok: false, message: 'Only local branches can be pushed.' })
  }
  if (!branch.upstream || !branch.remote) {
    return Promise.resolve({
      ok: false,
      message: `${branch.shortName} has no upstream — an ordinary push (-u) creates it; force is never needed there.`,
    })
  }
  return runAction(
    () => git.raw(['push', '--force-with-lease', branch.remote as string, branch.shortName]),
    `Force-pushed ${branch.shortName} to ${branch.upstream} (with lease)`
  )
}

/** Divergence recovery: replay local commits on top of the remote. */
export function pullCurrentBranchRebase(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['pull', '--rebase']),
    'Pulled with rebase — local commits replayed on top of the remote'
  )
}

/** Divergence recovery: merge the remote into the local branch. */
export function pullCurrentBranchMerge(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['pull', '--no-rebase']),
    'Pulled with merge — created a merge commit from the remote'
  )
}

export function fetchRemotes(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['fetch', '--all', '--prune']),
    'Fetched all remotes'
  )
}

export function pullCurrentBranch(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['pull', '--ff-only']),
    'Pulled current branch'
  )
}

export async function pushCurrentBranch(git: SimpleGit): Promise<BranchActionResult> {
  const hasUpstream = await git
    .raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    .then(() => true)
    .catch(() => false)
  if (hasUpstream) {
    return runAction(() => git.raw(['push']), 'Pushed current branch')
  }
  // No upstream yet — push with `-u` to create the remote branch AND set
  // tracking, instead of failing with git's bare "has no upstream" error.
  const remote = await resolveDefaultRemote(git)
  if (!remote) {
    return { ok: false, message: 'No upstream and no remote configured — add one with `git remote add origin <url>`.' }
  }
  const current = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return runAction(
    () => git.raw(['push', '-u', remote, current]),
    `Pushed ${current} and set upstream to ${remote}/${current}`
  )
}

/**
 * Set (or create) the upstream for a local branch from a user-typed target.
 *
 * The target may be a bare branch name (`main` → `<default-remote>/main`) or
 * a `remote/branch` ref (`origin/main`). If that remote-tracking branch
 * already exists, we just link to it (`git branch --set-upstream-to`). If it
 * does NOT exist yet — the common "I just created this branch" case — we
 * `git push -u` to create the remote branch and set tracking in one step.
 * The old behavior ran `--set-upstream-to <bare-name>`, which silently
 * resolved `main` to the *local* branch and left push still complaining.
 */
export async function setUpstream(
  git: SimpleGit,
  localBranch: string,
  target: string
): Promise<BranchActionResult> {
  const cleaned = target.trim()
  if (!cleaned) return { ok: false, message: 'Upstream ref required' }

  const targetError = rejectFlagLike(cleaned, `Upstream ref '${cleaned}'`)
  if (targetError) return { ok: false, message: targetError }

  const remotes = await listRemotes(git)
  const slash = cleaned.indexOf('/')
  let remote: string | undefined
  let remoteBranch: string
  if (slash > 0 && remotes.includes(cleaned.slice(0, slash))) {
    remote = cleaned.slice(0, slash)
    remoteBranch = cleaned.slice(slash + 1)
  } else {
    remote = remotes.includes('origin') ? 'origin' : remotes[0]
    remoteBranch = cleaned
  }
  if (!remote) {
    return { ok: false, message: 'No remote configured — add one with `git remote add origin <url>` first.' }
  }

  if (await remoteBranchExists(git, remote, remoteBranch)) {
    return runAction(
      () => git.raw(['branch', '--set-upstream-to', `${remote}/${remoteBranch}`, localBranch]),
      `Set ${localBranch} to track ${remote}/${remoteBranch}`
    )
  }
  // Remote branch doesn't exist yet — push it and set upstream in one step.
  return runAction(
    () => git.raw(['push', '-u', remote, `${localBranch}:${remoteBranch}`]),
    `Pushed ${localBranch} → ${remote}/${remoteBranch} and set upstream`
  )
}

/**
 * Push an arbitrary local branch (need not be the current branch) to
 * its remote. Refuses when the branch has no upstream and no remote
 * defaulting is configured — that branch needs a `git push -u …` from
 * the shell first.
 *
 * Pairs with `pushCurrentBranch` (no-arg variant); the workstation
 * dispatcher picks one or the other based on where the cursor is.
 */
export async function pushBranch(
  git: SimpleGit,
  branch: BranchRef
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return { ok: false, message: 'Only local branches can be pushed.' }
  }

  if (!branch.upstream || !branch.remote) {
    // No upstream yet — push with `-u` to create the remote branch AND set
    // tracking, rather than refusing and sending the user to the shell.
    const remote = await resolveDefaultRemote(git)
    if (!remote) {
      return {
        ok: false,
        message: `${branch.shortName} has no upstream and no remote is configured — add one with \`git remote add origin <url>\`.`,
      }
    }
    return runAction(
      () => git.raw(['push', '-u', remote, branch.shortName]),
      `Pushed ${branch.shortName} and set upstream to ${remote}/${branch.shortName}`
    )
  }

  return runAction(
    () => git.raw(['push', branch.remote as string, branch.shortName]),
    `Pushed ${branch.shortName} to ${branch.upstream}`
  )
}

/**
 * Fetch the cursored branch's upstream from its remote. Side-effect
 * free on the working tree — just updates the remote-tracking ref.
 * Works for any branch with an upstream regardless of checkout state.
 *
 * Falls back to a clean error when the branch has no upstream
 * configured (`git fetch <remote> <name>` would assume an unrelated
 * default refspec and surprise the user).
 */
export function fetchBranch(
  git: SimpleGit,
  branch: BranchRef
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return Promise.resolve({
      ok: false,
      message: 'Only local branches can be fetched per-branch — use F to fetch all remotes.',
    })
  }

  if (!branch.upstream || !branch.remote) {
    return Promise.resolve({
      ok: false,
      message: `${branch.shortName} has no upstream — set one with \`git push -u <remote> ${branch.shortName}\` to enable fetch.`,
    })
  }

  // `branch.upstream` is the short form (e.g. `origin/main`); the
  // ref name after the remote prefix is what fetch wants as the
  // refspec source. For a remote `origin` and upstream `origin/main`
  // we run `git fetch origin main`.
  const upstreamRef = branch.upstream.startsWith(`${branch.remote}/`)
    ? branch.upstream.slice(branch.remote.length + 1)
    : branch.upstream

  return runAction(
    () => git.raw(['fetch', branch.remote as string, upstreamRef]),
    `Fetched ${branch.upstream}`
  )
}

/**
 * Pull the cursored branch. Branches into two paths based on whether
 * the branch is currently checked out:
 *
 *   - **Current branch**: defer to `pullCurrentBranch` (standard
 *     `git pull --ff-only`).
 *   - **Non-current branch**: use the refspec form
 *     `git fetch <remote> <branch>:<branch>` which advances the local
 *     ref to match the remote ref ONLY if the update is fast-forward.
 *     Returns non-zero on non-FF without touching the working tree.
 *     Diverged branches need a checkout + `pull --rebase` from the
 *     user; we refuse rather than try to do that for them.
 *
 * `currentBranchName` lets the dispatcher compare without re-querying
 * git — it already has the value in `context.branches.currentBranch`.
 */
export function pullBranch(
  git: SimpleGit,
  branch: BranchRef,
  currentBranchName: string | undefined
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return Promise.resolve({
      ok: false,
      message: 'Only local branches can be pulled.',
    })
  }

  if (!branch.upstream || !branch.remote) {
    return Promise.resolve({
      ok: false,
      message: `${branch.shortName} has no upstream — set one with \`git push -u <remote> ${branch.shortName}\` to enable pull.`,
    })
  }

  // Current branch — defer to the in-place workflow.
  if (branch.shortName === currentBranchName) {
    return pullCurrentBranch(git)
  }

  // Non-current branch — refspec-based fast-forward refusing non-FF.
  // `branch.upstream` is `<remote>/<ref>`; strip the remote prefix to
  // get the upstream ref name to fetch.
  const upstreamRef = branch.upstream.startsWith(`${branch.remote}/`)
    ? branch.upstream.slice(branch.remote.length + 1)
    : branch.upstream

  return runAction(
    () =>
      git.raw([
        'fetch',
        branch.remote as string,
        `${upstreamRef}:${branch.shortName}`,
      ]),
    `Fast-forwarded ${branch.shortName} to ${branch.upstream}`
  )
}
