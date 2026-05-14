import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import { formatIssueList } from '../../git/githubListFormatting'
import { getIssueList, type IssueListFilter } from '../../git/issuesListData'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { IssuesArgv } from './config'

export const handler: CommandHandler<IssuesArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  const filter: IssueListFilter = {
    state: argv.state,
    assignee: argv.mine ? '@me' : argv.assignee,
    author: argv.author,
    label: argv.label,
    search: argv.search,
    limit: argv.limit,
  }

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

  const issues = overview.issues || []

  if (argv.json) {
    logger.log(JSON.stringify(issues, null, 2))
    return
  }

  if (overview.repository) {
    const filterParts: string[] = []
    if (filter.state && filter.state !== 'open') filterParts.push(`state=${filter.state}`)
    if (filter.assignee) filterParts.push(`assignee=${filter.assignee}`)
    if (filter.author) filterParts.push(`author=${filter.author}`)
    if (filter.label) filterParts.push(`label=${filter.label}`)
    if (filter.search) filterParts.push(`search=${JSON.stringify(filter.search)}`)
    const suffix = filterParts.length ? chalk.dim(` (${filterParts.join(', ')})`) : ''
    logger.log(
      chalk.bold(`${overview.repository.owner}/${overview.repository.name}`) +
      chalk.dim(` · ${issues.length} issue${issues.length === 1 ? '' : 's'}`) +
      suffix
    )
    logger.log('')
  }

  logger.log(formatIssueList(issues))
}
