import { formatIssueList } from '../../git/githubListFormatting'
import {
  getIssueList,
  type IssueListFilter,
  type IssueListItem,
  type IssueListOverview,
} from '../../git/issuesListData'
import { getGitLabIssueList } from '../../git/gitlabListData'
import { getBitbucketIssueList } from '../../git/bitbucketListData'
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
  fetch: (git, filter, provider) =>
    provider === 'gitlab'
      ? getGitLabIssueList(git, filter)
      : provider === 'bitbucket'
        ? getBitbucketIssueList(git, filter)
        : getIssueList(git, filter),
  extractItems: (overview) => overview.issues,
  toCachePayload: (items) => ({ kind: 'issues', items }),
  formatList: formatIssueList,
  summarizeFilter: summarizeCommonFilter,
})
