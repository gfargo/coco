import { SimpleGit } from 'simple-git'
import {
  defaultGhRunner,
  getGitHubRepository,
  isGhAuthenticated,
  type GhRunner,
  type GitHubRepository,
} from './githubCli'

export type PullRequestState = 'open' | 'closed' | 'merged' | 'all'

export type PullRequestListItem = {
  number: number
  title: string
  url: string
  state: string // OPEN | CLOSED | MERGED
  isDraft: boolean
  headRefName: string
  baseRefName: string
  author?: string
  assignees?: string[]
  labels?: string[]
  reviewDecision?: string
  mergeable?: string
  mergeStateStatus?: string
  createdAt: string
  updatedAt: string
}

/**
 * Filter knobs passed to `gh pr list`. Mirrors `IssueListFilter`'s
 * design — every entry maps 1:1 to a `gh` flag so users can reach
 * for any `gh pr list` knob through coco's wrapper without learning
 * a new vocabulary.
 */
export type PullRequestListFilter = {
  state?: PullRequestState
  /** Maps to `--assignee`. Accepts a login or `@me`. */
  assignee?: string
  /** Maps to `--author`. */
  author?: string
  /** Comma-separated label list. Maps to `--label`. */
  label?: string
  /** Maps to `--search`. Free-form GitHub PR search syntax. */
  search?: string
  /** Maps to `--draft`. Set true to surface draft PRs only. */
  draft?: boolean
  /** Maps to `--limit`. Default 30 (gh's own default). */
  limit?: number
  /** Filter to PRs targeting a specific base branch. Maps to `--base`. */
  base?: string
  /** Filter to PRs originating from a specific head branch. Maps to `--head`. */
  head?: string
}

export type PullRequestListOverview = {
  available: boolean
  authenticated: boolean
  repository?: GitHubRepository
  pullRequests?: PullRequestListItem[]
  filter?: PullRequestListFilter
  message?: string
}

/**
 * `gh pr list --json` field list. Trimmer than `pullRequestData.ts`'s
 * single-PR field set — the triage list view doesn't need bodies,
 * statusCheckRollup, or per-review breakdowns (those live in the
 * inspector that opens when the user picks a row).
 */
export const PULL_REQUEST_LIST_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'headRefName',
  'baseRefName',
  'author',
  'assignees',
  'labels',
  'reviewDecision',
  'mergeable',
  'mergeStateStatus',
  'createdAt',
  'updatedAt',
].join(',')

function parsePullRequestListItems(output: string): PullRequestListItem[] {
  const trimmed = output.trim()
  if (!trimmed) return []

  const raw = JSON.parse(trimmed) as Array<Record<string, unknown>>

  return raw.map((entry) => {
    const author =
      entry.author && typeof entry.author === 'object' && 'login' in entry.author
        ? String((entry.author as { login: unknown }).login)
        : undefined

    const assignees = Array.isArray(entry.assignees)
      ? (entry.assignees as Array<Record<string, unknown>>)
        .map((a) => (a && 'login' in a ? String((a as { login: unknown }).login) : ''))
        .filter(Boolean)
      : undefined

    const labels = Array.isArray(entry.labels)
      ? (entry.labels as Array<Record<string, unknown>>)
        .map((l) => (l && 'name' in l ? String((l as { name: unknown }).name) : ''))
        .filter(Boolean)
      : undefined

    return {
      number: entry.number as number,
      title: String(entry.title || ''),
      url: String(entry.url || ''),
      state: String(entry.state || ''),
      isDraft: Boolean(entry.isDraft),
      headRefName: String(entry.headRefName || ''),
      baseRefName: String(entry.baseRefName || ''),
      author,
      assignees,
      labels,
      reviewDecision:
        typeof entry.reviewDecision === 'string' ? entry.reviewDecision : undefined,
      mergeable: typeof entry.mergeable === 'string' ? entry.mergeable : undefined,
      mergeStateStatus:
        typeof entry.mergeStateStatus === 'string' ? entry.mergeStateStatus : undefined,
      createdAt: String(entry.createdAt || ''),
      updatedAt: String(entry.updatedAt || ''),
    }
  })
}

function buildGhArgs(filter: PullRequestListFilter): string[] {
  const args = ['pr', 'list', '--json', PULL_REQUEST_LIST_JSON_FIELDS]

  if (filter.state) args.push('--state', filter.state)
  if (filter.assignee) args.push('--assignee', filter.assignee)
  if (filter.author) args.push('--author', filter.author)
  if (filter.label) args.push('--label', filter.label)
  if (filter.search) args.push('--search', filter.search)
  if (filter.draft) args.push('--draft')
  if (filter.base) args.push('--base', filter.base)
  if (filter.head) args.push('--head', filter.head)
  if (typeof filter.limit === 'number') args.push('--limit', String(filter.limit))

  return args
}

export async function getPullRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestListOverview> {
  const repository = await getGitHubRepository(git)

  if (!repository) {
    return {
      available: false,
      authenticated: false,
      filter,
      message: 'No GitHub remote detected.',
    }
  }

  if (!(await isGhAuthenticated(runner))) {
    return {
      available: true,
      authenticated: false,
      repository,
      filter,
      message: 'GitHub CLI is missing or not authenticated.',
    }
  }

  try {
    const output = await runner(buildGhArgs(filter))
    return {
      available: true,
      authenticated: true,
      repository,
      filter,
      pullRequests: parsePullRequestListItems(output),
    }
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository,
      filter,
      message: error instanceof Error ? error.message : 'Failed to fetch pull request list.',
    }
  }
}
