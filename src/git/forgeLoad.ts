/**
 * Shared "detect → auth probe → fetch/catch" availability ladder used by
 * every forge list/overview loader (GitHub, GitLab, Bitbucket). Each loader
 * only supplies its own project detector, auth prober, and fetch — the
 * envelope shape (`available`/`authenticated`/`repository`/`message`) is
 * assembled once here instead of being re-pasted per forge.
 */

type ForgeStatus = { kind: string }

export type LoadForgeListParams<P, Repo, F, T extends object, S extends ForgeStatus> = {
  detect: () => Promise<P | undefined>
  notDetectedMessage: string
  probe: (project: P) => Promise<S>
  describeStatus: (status: S) => string
  repository: (project: P) => Repo
  filter: F
  fetch: (project: P) => Promise<T>
  fetchErrorMessage: string
}

export type ForgeListEnvelope<Repo, F, T> = {
  available: boolean
  authenticated: boolean
  repository?: Repo
  filter?: F
  message?: string
} & Partial<T>

/**
 * Shared core for the 6 list loaders (`getPullRequestList`, `getIssueList`,
 * `getMergeRequestList`, `getGitLabIssueList`, `getBitbucketPullRequestList`,
 * `getBitbucketIssueList`). Builds the `{available, authenticated,
 * repository, filter, message}` envelope; each caller supplies only its
 * project detector, auth prober, and the actual list fetch.
 */
export async function loadForgeList<P, Repo, F, T extends object, S extends ForgeStatus>(
  params: LoadForgeListParams<P, Repo, F, T, S>
): Promise<ForgeListEnvelope<Repo, F, T>> {
  const project = await params.detect()
  if (!project) {
    return {
      available: false,
      authenticated: false,
      filter: params.filter,
      message: params.notDetectedMessage,
    } as ForgeListEnvelope<Repo, F, T>
  }

  const repository = params.repository(project)

  const status = await params.probe(project)
  if (status.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository,
      filter: params.filter,
      message: params.describeStatus(status),
    } as ForgeListEnvelope<Repo, F, T>
  }

  try {
    const data = await params.fetch(project)
    return {
      available: true,
      authenticated: true,
      repository,
      filter: params.filter,
      ...data,
    } as ForgeListEnvelope<Repo, F, T>
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository,
      filter: params.filter,
      message: error instanceof Error ? error.message : params.fetchErrorMessage,
    } as ForgeListEnvelope<Repo, F, T>
  }
}

type GitLike = { raw(args: string[]): Promise<string> }

export type LoadForgeOverviewParams<P, Repo, T extends object, S extends ForgeStatus> = {
  git: GitLike
  detect: () => Promise<P | undefined>
  notDetectedMessage: string
  probe: (project: P) => Promise<S>
  describeStatus: (status: S) => string
  repository: (project: P) => Repo
  /**
   * When true, short-circuits with a "No current branch." message before
   * calling `fetch` at all (GitLab/Bitbucket semantics). When false, `fetch`
   * always runs and is responsible for its own no-branch handling via
   * `fetchErrorMessage` (GitHub's `getPullRequestOverview` semantics — it
   * still attempts `gh pr view` even with no resolved branch).
   */
  requireCurrentBranch: boolean
  fetch: (project: P, currentBranch: string | undefined) => Promise<T>
  fetchErrorMessage: (currentBranch: string | undefined) => string
}

export type ForgeOverviewEnvelope<Repo, T> = {
  available: boolean
  authenticated: boolean
  repository?: Repo
  currentBranch?: string
  message?: string
} & Partial<T>

/**
 * Shared core for the 3 single-item overview loaders (`getPullRequestOverview`,
 * `getMergeRequestOverview`, `getBitbucketPullRequestOverview`). Adds the
 * current-branch read on top of `loadForgeList`'s availability core.
 */
export async function loadForgeOverview<P, Repo, T extends object, S extends ForgeStatus>(
  params: LoadForgeOverviewParams<P, Repo, T, S>
): Promise<ForgeOverviewEnvelope<Repo, T>> {
  const [project, branchOut] = await Promise.all([params.detect(), params.git.raw(['branch', '--show-current'])])
  const currentBranch = branchOut.trim() || undefined

  if (!project) {
    return {
      available: false,
      authenticated: false,
      currentBranch,
      message: params.notDetectedMessage,
    } as ForgeOverviewEnvelope<Repo, T>
  }

  const repository = params.repository(project)

  const status = await params.probe(project)
  if (status.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository,
      currentBranch,
      message: params.describeStatus(status),
    } as ForgeOverviewEnvelope<Repo, T>
  }

  if (params.requireCurrentBranch && !currentBranch) {
    return {
      available: true,
      authenticated: true,
      repository,
      message: 'No current branch.',
    } as ForgeOverviewEnvelope<Repo, T>
  }

  try {
    const data = await params.fetch(project, currentBranch)
    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      ...data,
    } as ForgeOverviewEnvelope<Repo, T>
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      message: error instanceof Error ? error.message : params.fetchErrorMessage(currentBranch),
    } as ForgeOverviewEnvelope<Repo, T>
  }
}
