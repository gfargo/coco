import { formatPullRequestList } from '../../git/githubListFormatting'
import {
  getPullRequestList,
  type PullRequestListFilter,
  type PullRequestListItem,
  type PullRequestListOverview,
} from '../../git/pullRequestListData'
import { getMergeRequestList } from '../../git/gitlabListData'
import type { CachedPullRequestList } from '../../git/githubListCache'
import {
  createGitHubListHandler,
  summarizeCommonFilter,
} from '../utils/githubListCommand'
import { PrsArgv } from './config'

export const handler = createGitHubListHandler<
  PrsArgv,
  PullRequestListFilter,
  PullRequestListItem,
  PullRequestListOverview,
  CachedPullRequestList
>({
  kind: 'prs',
  noun: 'pull request',
  gitlabNoun: 'merge request',
  triageLabel: 'PR triage',
  buildFilter: (argv) => ({
    state: argv.state,
    assignee: argv.mine ? '@me' : argv.assignee,
    author: argv.author,
    label: argv.label,
    search: argv.search,
    base: argv.base,
    head: argv.head,
    draft: argv.draft,
    limit: argv.limit,
  }),
  fetch: (git, filter, provider) =>
    provider === 'gitlab' ? getMergeRequestList(git, filter) : getPullRequestList(git, filter),
  extractItems: (overview) => overview.pullRequests,
  toCachePayload: (items) => ({ kind: 'prs', items }),
  formatList: formatPullRequestList,
  summarizeFilter: (filter) => {
    const parts = summarizeCommonFilter(filter)
    if (filter.base) parts.push(`base=${filter.base}`)
    if (filter.head) parts.push(`head=${filter.head}`)
    if (filter.draft) parts.push('draft')
    return parts
  },
})
