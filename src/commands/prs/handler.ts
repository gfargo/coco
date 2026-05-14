import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { formatPullRequestList } from '../../git/githubListFormatting'
import {
  getPullRequestList,
  type PullRequestListFilter,
} from '../../git/pullRequestListData'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { PrsArgv } from './config'

export const handler: CommandHandler<PrsArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

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

  const prs = overview.pullRequests || []

  if (argv.json) {
    logger.log(JSON.stringify(prs, null, 2))
    return
  }

  if (overview.repository) {
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
    logger.log(
      chalk.bold(`${overview.repository.owner}/${overview.repository.name}`) +
      chalk.dim(` · ${prs.length} pull request${prs.length === 1 ? '' : 's'}`) +
      suffix
    )
    logger.log('')
  }

  logger.log(formatPullRequestList(prs))
}
