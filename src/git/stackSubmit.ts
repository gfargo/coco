import { SimpleGit } from 'simple-git'
import { buildStack, getAllStackParents } from './stackData'
import { getProviderOverview } from './providerData'
import { getForgeActions } from './forgeActions'
import { runPullRequestBodyWorkflow } from './aiActions'

export type StackSubmitEntryStatus = 'created' | 'already-exists' | 'failed'

export type StackSubmitEntryResult = {
  branch: string
  parent: string
  status: StackSubmitEntryStatus
  message: string
  number?: number
  url?: string
}

export type StackSubmitSummary = {
  entries: StackSubmitEntryResult[]
  created: number
  skipped: number
  failed: number
}

export type StackSubmitResult =
  | { ok: true; summary: StackSubmitSummary }
  | { ok: false; message: string }

export type StackSubmitOptions = {
  draft?: boolean
}

/**
 * Walk the current branch's stack (root -> tip) and open a pull request for
 * every branch that doesn't already have one open, using each branch's
 * recorded `coco-parent` as the PR base.
 *
 * Both "does a PR already exist for this branch" and "generate a title/body
 * from this branch's diff" are HEAD-scoped (`getProviderOverview` /
 * `runPullRequestBodyWorkflow`), so each stack entry is checked out in turn.
 * That requires a clean working tree up front and a best-effort restore of
 * the original branch afterward.
 */
export async function submitStack(
  git: SimpleGit,
  options: StackSubmitOptions = {}
): Promise<StackSubmitResult> {
  const overview = await getProviderOverview(git)
  const provider = overview.repository.provider

  if (
    provider !== 'github' &&
    provider !== 'gitlab' &&
    provider !== 'bitbucket' &&
    provider !== 'bitbucket-server' &&
    provider !== 'gitea'
  ) {
    return {
      ok: false,
      message:
        overview.repository.message ||
        'No supported remote (GitHub, GitLab, Bitbucket, Bitbucket Server, or Gitea) detected.',
    }
  }

  if (!overview.authenticated) {
    return { ok: false, message: overview.message || 'The forge CLI is unavailable.' }
  }

  const originalBranch = overview.currentBranch
  if (!originalBranch) {
    return { ok: false, message: 'Could not determine the current branch (detached HEAD?).' }
  }

  const treeStatus = await git.status()
  if (!treeStatus.isClean()) {
    return {
      ok: false,
      message:
        'Working tree has uncommitted changes — commit or stash before running `coco stack submit` (each branch in the stack is checked out in turn).',
    }
  }

  const parents = await getAllStackParents(git)
  const stack = await buildStack(git, originalBranch, parents)

  const repoPath =
    overview.repository.owner && overview.repository.name
      ? `${overview.repository.owner}/${overview.repository.name}`
      : undefined

  const entries: StackSubmitEntryResult[] = []

  try {
    for (const entry of stack) {
      // Root/base branch has no recorded parent — never open a PR for it.
      if (!entry.parent) continue
      const parent = entry.parent

      try {
        await git.checkout(entry.branch)
      } catch (error) {
        entries.push({
          branch: entry.branch,
          parent,
          status: 'failed',
          message: (error as Error).message,
        })
        continue
      }

      const branchOverview = await getProviderOverview(git)

      if (branchOverview.currentPullRequest) {
        entries.push({
          branch: entry.branch,
          parent,
          status: 'already-exists',
          message: `Pull request #${branchOverview.currentPullRequest.number} already exists (${branchOverview.currentPullRequest.state})`,
          number: branchOverview.currentPullRequest.number,
        })
        continue
      }

      const generated = await runPullRequestBodyWorkflow({ baseBranch: parent })
      if (!generated.ok) {
        entries.push({
          branch: entry.branch,
          parent,
          status: 'failed',
          message: generated.message || 'Failed to generate a pull request body.',
        })
        continue
      }

      const title = (generated.title || '').trim()
      const body = (generated.body || '').trim()
      if (!title) {
        entries.push({
          branch: entry.branch,
          parent,
          status: 'failed',
          message: 'Could not produce a pull request title.',
        })
        continue
      }

      const forge = getForgeActions(provider, {
        gitlabPath: repoPath,
        gitlabHost: overview.repository.host,
        bitbucketPath: repoPath,
        bitbucketHost: overview.repository.host,
        bitbucketServerPath: repoPath,
        bitbucketServerHost: overview.repository.host,
        giteaPath: repoPath,
        giteaHost: overview.repository.host,
      })

      try {
        const result = await forge.createPullRequest({
          base: parent,
          head: entry.branch,
          title,
          body,
          draft: Boolean(options.draft),
        })

        entries.push(
          result.ok
            ? { branch: entry.branch, parent, status: 'created', message: result.message, url: result.url }
            : { branch: entry.branch, parent, status: 'failed', message: result.message }
        )
      } catch (error) {
        entries.push({
          branch: entry.branch,
          parent,
          status: 'failed',
          message: (error as Error).message,
        })
      }
    }
  } finally {
    try {
      await git.checkout(originalBranch)
    } catch {
      // Best-effort restore — the loop above already reports whatever failed.
    }
  }

  const summary: StackSubmitSummary = {
    entries,
    created: entries.filter((entry) => entry.status === 'created').length,
    skipped: entries.filter((entry) => entry.status === 'already-exists').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
  }

  return { ok: true, summary }
}
