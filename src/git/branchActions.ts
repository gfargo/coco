import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'

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
  return runAction(
    () => git.raw(['switch', '-c', branchName, startPoint]),
    `Created branch ${branchName} from ${startPoint}`
  )
}

export function renameBranch(
  git: SimpleGit,
  oldName: string,
  newName: string
): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['branch', '-m', oldName, newName]),
    `Renamed ${oldName} to ${newName}`
  )
}

export function deleteBranch(git: SimpleGit, branch: BranchRef): Promise<BranchActionResult> {
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

  return runAction(
    () => git.raw(['branch', '-d', branch.shortName]),
    `Deleted branch ${branch.shortName}`
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

export function pushCurrentBranch(git: SimpleGit): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['push']),
    'Pushed current branch'
  )
}

export function setUpstream(
  git: SimpleGit,
  localBranch: string,
  upstreamBranch: string
): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['branch', '--set-upstream-to', upstreamBranch, localBranch]),
    `Set ${localBranch} upstream to ${upstreamBranch}`
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
export function pushBranch(
  git: SimpleGit,
  branch: BranchRef
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return Promise.resolve({
      ok: false,
      message: 'Only local branches can be pushed.',
    })
  }

  if (!branch.upstream || !branch.remote) {
    return Promise.resolve({
      ok: false,
      message: `${branch.shortName} has no upstream — checkout the branch and run \`git push -u <remote> ${branch.shortName}\` first.`,
    })
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
      message: `${branch.shortName} has no upstream — nothing to fetch.`,
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
      message: `${branch.shortName} has no upstream — nothing to pull.`,
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
