import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'

export type BranchActionResult = {
  ok: boolean
  message: string
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
