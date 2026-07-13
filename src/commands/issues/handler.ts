import { formatIssueList } from '../../git/githubListFormatting'
import type {
  IssueListFilter,
  IssueListItem,
  IssueListOverview,
} from '../../git/issuesListData'
import type { CachedIssueList } from '../../git/githubListCache'
import {
  createGitHubListHandler,
  summarizeCommonFilter,
} from '../utils/githubListCommand'
import { IssuesArgv } from './config'

export const handler = createGitHubListHandler<
  IssuesArgv,
  IssueListFilter,
  IssueListItem,
  IssueListOverview,
  CachedIssueList
>({
  kind: 'issues',
  noun: 'issue',
  triageLabel: 'issue triage',
  buildFilter: (argv) => ({
    state: argv.state,
    assignee: argv.mine ? '@me' : argv.assignee,
    author: argv.author,
    label: argv.label,
    search: argv.search,
    limit: argv.limit,
  }),
  fetch: (git, filter, forge) => forge.getIssueList(git, filter),
  extractItems: (overview) => overview.issues,
  toCachePayload: (items) => ({ kind: 'issues', items }),
  formatList: formatIssueList,
  summarizeFilter: summarizeCommonFilter,
})
