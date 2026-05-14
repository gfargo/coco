import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { getGitHubRepository } from '../../git/githubCli'
import { formatPullRequestList } from '../../git/githubListFormatting'
import { readCachedList, writeCachedList } from '../../git/githubListCache'
import {
  getPullRequestList,
  type PullRequestListFilter,
  type PullRequestListItem,
} from '../../git/pullRequestListData'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { PrsArgv } from './config'

export const handler: CommandHandler<PrsArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const repoPath = process.cwd()

  const filter: PullRequestListFilter = {
    state: argv.state,
    assignee: argv.mine ? '@me' : argv.assignee,
    author: argv.author,
    label: argv.label,
    search: argv.search,
    base: argv.base,
    head: argv.head,
    draft: argv.draft,
    limit: argv.limit,
  }

  const cacheEnabled = !argv.noCache
  let prs: PullRequestListItem[] | undefined
  let fromCache = false
  let cacheAgeMs: number | undefined

  const repository = await getGitHubRepository(git)

  if (cacheEnabled && !argv.refresh) {
    const cached = readCachedList<{
      kind: 'prs'
      items: PullRequestListItem[]
    }>('prs', repoPath, filter)
    if (cached?.fresh) {
      prs = cached.payload.items
      fromCache = true
      cacheAgeMs = cached.ageMs
    }
  }

  if (!prs) {
    const overview = await getPullRequestList(git, filter)

    if (!overview.available) {
      logger.log(chalk.red(overview.message || 'No GitHub remote detected.'))
      commandExit(1)
      return
    }

    if (!overview.authenticated) {
      logger.log(chalk.yellow(overview.message || 'GitHub CLI is missing or not authenticated.'))
      logger.log(chalk.dim('Install `gh` and run `gh auth login` to enable PR triage.'))
      commandExit(1)
      return
    }

    if (overview.message) {
      logger.log(chalk.red(overview.message))
      commandExit(1)
      return
    }

    prs = overview.pullRequests || []

    if (cacheEnabled) {
      writeCachedList(repoPath, filter, { kind: 'prs', items: prs })
    }
  }

  if (argv.json) {
    logger.log(JSON.stringify(prs, null, 2))
    return
  }

  if (repository) {
    const filterParts: string[] = []
    if (filter.state && filter.state !== 'open') filterParts.push(`state=${filter.state}`)
    if (filter.assignee) filterParts.push(`assignee=${filter.assignee}`)
    if (filter.author) filterParts.push(`author=${filter.author}`)
    if (filter.label) filterParts.push(`label=${filter.label}`)
    if (filter.search) filterParts.push(`search=${JSON.stringify(filter.search)}`)
    if (filter.base) filterParts.push(`base=${filter.base}`)
    if (filter.head) filterParts.push(`head=${filter.head}`)
    if (filter.draft) filterParts.push('draft')
    const suffix = filterParts.length ? chalk.dim(` (${filterParts.join(', ')})`) : ''
    const cacheTag = fromCache && typeof cacheAgeMs === 'number'
      ? chalk.dim(` · cached ${Math.round(cacheAgeMs / 1000)}s ago`)
      : ''
    logger.log(
      chalk.bold(`${repository.owner}/${repository.name}`) +
      chalk.dim(` · ${prs.length} pull request${prs.length === 1 ? '' : 's'}`) +
      suffix +
      cacheTag
    )
    logger.log('')
  }

  logger.log(formatPullRequestList(prs))
}
