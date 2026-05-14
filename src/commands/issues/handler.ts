import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { getGitHubRepository } from '../../git/githubCli'
import { formatIssueList } from '../../git/githubListFormatting'
import { readCachedList, writeCachedList } from '../../git/githubListCache'
import {
  getIssueList,
  type IssueListFilter,
  type IssueListItem,
} from '../../git/issuesListData'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { IssuesArgv } from './config'

export const handler: CommandHandler<IssuesArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  // `applyRepoFlag` chdir'd to the repo path (or kept process.cwd
  // when --repo was omitted), so the cache key derives from a stable
  // absolute path either way.
  const repoPath = process.cwd()

  const filter: IssueListFilter = {
    state: argv.state,
    assignee: argv.mine ? '@me' : argv.assignee,
    author: argv.author,
    label: argv.label,
    search: argv.search,
    limit: argv.limit,
  }

  const cacheEnabled = !argv.noCache
  let issues: IssueListItem[] | undefined
  let fromCache = false
  let cacheAgeMs: number | undefined

  // Repository metadata is needed for the header in both code paths
  // (cache hit and fresh fetch). The cache hit path skips
  // `getIssueList` entirely, so probe it directly here. Cheap — no
  // network, just a single `git remote` parse.
  const repository = await getGitHubRepository(git)

  if (cacheEnabled && !argv.refresh) {
    const cached = readCachedList<{ kind: 'issues'; items: IssueListItem[] }>(
      'issues',
      repoPath,
      filter
    )
    if (cached?.fresh) {
      issues = cached.payload.items
      fromCache = true
      cacheAgeMs = cached.ageMs
    }
  }

  if (!issues) {
    const overview = await getIssueList(git, filter)

    if (!overview.available) {
      logger.log(chalk.red(overview.message || 'No GitHub remote detected.'))
      commandExit(1)
      return
    }

    if (!overview.authenticated) {
      logger.log(chalk.yellow(overview.message || 'GitHub CLI is missing or not authenticated.'))
      logger.log(chalk.dim('Install `gh` and run `gh auth login` to enable issue triage.'))
      commandExit(1)
      return
    }

    if (overview.message) {
      logger.log(chalk.red(overview.message))
      commandExit(1)
      return
    }

    issues = overview.issues || []

    if (cacheEnabled) {
      writeCachedList(repoPath, filter, { kind: 'issues', items: issues })
    }
  }

  if (argv.json) {
    logger.log(JSON.stringify(issues, null, 2))
    return
  }

  if (repository) {
    const filterParts: string[] = []
    if (filter.state && filter.state !== 'open') filterParts.push(`state=${filter.state}`)
    if (filter.assignee) filterParts.push(`assignee=${filter.assignee}`)
    if (filter.author) filterParts.push(`author=${filter.author}`)
    if (filter.label) filterParts.push(`label=${filter.label}`)
    if (filter.search) filterParts.push(`search=${JSON.stringify(filter.search)}`)
    const suffix = filterParts.length ? chalk.dim(` (${filterParts.join(', ')})`) : ''
    const cacheTag = fromCache && typeof cacheAgeMs === 'number'
      ? chalk.dim(` · cached ${Math.round(cacheAgeMs / 1000)}s ago`)
      : ''
    logger.log(
      chalk.bold(`${repository.owner}/${repository.name}`) +
      chalk.dim(` · ${issues.length} issue${issues.length === 1 ? '' : 's'}`) +
      suffix +
      cacheTag
    )
    logger.log('')
  }

  logger.log(formatIssueList(issues))
}
