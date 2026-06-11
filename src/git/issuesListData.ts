import { SimpleGit } from 'simple-git'
import { sanitizeIssueListItem } from './forgeText'
import {
    defaultGhRunner,
    describeGhStatus,
    getGhStatus,
    getGitHubRepository, type GhRunner,
    type GitHubRepository
} from './githubCli'

export type IssueState = 'open' | 'closed' | 'all'

export type IssueListItem = {
  number: number
  title: string
  url: string
  state: string // OPEN | CLOSED
  author?: string
  assignees?: string[]
  labels?: string[]
  comments?: number
  createdAt: string
  updatedAt: string
}

/**
 * Filter knobs passed to `gh issue list`. Each maps 1:1 to a `gh` flag —
 * keeps the surface small and the mental model "anything `gh issue
 * list` accepts" so users discovering this CLI don't have to learn a
 * separate vocabulary.
 */
export type IssueListFilter = {
  state?: IssueState
  /** GitHub login or the literal "@me". Maps to `--assignee`. */
  assignee?: string
  /** Maps to `--author`. */
  author?: string
  /** Comma-separated label list. Maps to `--label`. */
  label?: string
  /** Maps to `--search`. Free-form GitHub issue search syntax. */
  search?: string
  /** Maps to `--limit`. Default 30 (gh's own default). */
  limit?: number
}

export type IssueListOverview = {
  available: boolean
  authenticated: boolean
  repository?: GitHubRepository
  issues?: IssueListItem[]
  /** Filter that produced the list — echoed back so cache layers can key on it. */
  filter?: IssueListFilter
  message?: string
}

/**
 * `gh issue list --json` field list. Centralized so any future
 * re-fetch (refresh, cache invalidation) requests the same shape and
 * the parser can rely on every field being present (even if optional).
 */
export const ISSUE_LIST_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'author',
  'assignees',
  'labels',
  'comments',
  'createdAt',
  'updatedAt',
].join(',')

function parseIssueListItems(output: string): IssueListItem[] {
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
      author,
      assignees,
      labels,
      comments: typeof entry.comments === 'number' ? entry.comments : undefined,
      createdAt: String(entry.createdAt || ''),
      updatedAt: String(entry.updatedAt || ''),
    }
  })
}

function buildGhArgs(filter: IssueListFilter): string[] {
  const args = ['issue', 'list', '--json', ISSUE_LIST_JSON_FIELDS]

  if (filter.state) args.push('--state', filter.state)
  if (filter.assignee) args.push('--assignee', filter.assignee)
  if (filter.author) args.push('--author', filter.author)
  if (filter.label) args.push('--label', filter.label)
  if (filter.search) args.push('--search', filter.search)
  if (typeof filter.limit === 'number') args.push('--limit', String(filter.limit))

  return args
}

export async function getIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runner: GhRunner = defaultGhRunner
): Promise<IssueListOverview> {
  const repository = await getGitHubRepository(git)

  if (!repository) {
    return {
      available: false,
      authenticated: false,
      filter,
      message: 'No GitHub remote detected.',
    }
  }

  const ghStatus = await getGhStatus(runner)
  if (ghStatus.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository,
      filter,
      message: describeGhStatus(ghStatus),
    }
  }

  try {
    const output = await runner(buildGhArgs(filter))
    return {
      available: true,
      authenticated: true,
      repository,
      filter,
      issues: parseIssueListItems(output).map(sanitizeIssueListItem),
    }
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository,
      filter,
      message: error instanceof Error ? error.message : 'Failed to fetch issue list.',
    }
  }
}
