import chalk from 'chalk'
import { SimpleGit } from 'simple-git'
import { CommandHandler } from '../../lib/types'
import { commandExit } from '../../lib/utils/commandExit'
import {
  getProviderRepositoryForGit,
  type GitProviderType,
} from '../../git/providerData'
import {
  CachedList,
  readCachedList,
  writeCachedList,
} from '../../git/githubListCache'
import type { IssueListFilter } from '../../git/issuesListData'
import type { PullRequestListFilter } from '../../git/pullRequestListData'
import { applyRepoFlag } from './applyRepoFlag'
import { emitJson } from '../../lib/ui/emitJson'

/**
 * Shared shape behind `coco issues` and `coco prs`. The two commands were
 * ~90% identical (cache probe → fetch → 3-branch availability ladder → cache
 * write → JSON/header/list render). This factory keeps the control flow in one
 * place; each command only supplies the bits that actually differ.
 */

/** Filter shapes accepted by the GitHub list cache. */
type ListFilter = IssueListFilter | PullRequestListFilter

/** Common availability fields every list overview exposes. */
type ListOverview = {
  available: boolean
  authenticated: boolean
  message?: string
}

/** Argv fields the factory reads directly; commands extend this. */
type BaseListArgv = {
  /** Global `--repo <dir>` flag consumed by applyRepoFlag. */
  repo?: string
  /**
   * Whether caching is enabled. Corresponds to the `--cache` / `--no-cache`
   * CLI flags (default: true — pass `--no-cache` to disable).
   */
  cache?: boolean
  refresh?: boolean
  json?: boolean
}

export type GitHubListCommandSpec<
  Argv extends BaseListArgv,
  Filter extends ListFilter,
  Item,
  Overview extends ListOverview,
  Cached extends CachedList
> = {
  /** Cache namespace + payload discriminant ('issues' | 'prs'). */
  kind: Cached['kind']
  /** Singular noun for the count line, e.g. 'issue' | 'pull request'. */
  noun: string
  /**
   * Forge-specific singular noun used when the detected remote is GitLab
   * (e.g. 'merge request'). Falls back to `noun` when unset.
   */
  gitlabNoun?: string
  /** Short label for the auth hint, e.g. 'issue triage' | 'PR triage'. */
  triageLabel: string
  buildFilter: (argv: Argv) => Filter
  /** Fetch the list, dispatching on the detected forge (github | gitlab). */
  fetch: (git: SimpleGit, filter: Filter, provider: GitProviderType | undefined) => Promise<Overview>
  extractItems: (overview: Overview) => Item[] | undefined
  toCachePayload: (items: Item[]) => Cached
  /** Render the list body. `nounLower` is the forge-aware singular noun. */
  formatList: (items: Item[], nounLower?: string) => string
  summarizeFilter: (filter: Filter) => string[]
}

/**
 * Filter-summary parts shared by both commands. The PR command appends its
 * own base/head/draft parts on top of these.
 */
export function summarizeCommonFilter(filter: ListFilter): string[] {
  const parts: string[] = []
  if (filter.state && filter.state !== 'open') parts.push(`state=${filter.state}`)
  if (filter.assignee) parts.push(`assignee=${filter.assignee}`)
  if (filter.author) parts.push(`author=${filter.author}`)
  if (filter.label) parts.push(`label=${filter.label}`)
  if (filter.search) parts.push(`search=${JSON.stringify(filter.search)}`)
  return parts
}

export function createGitHubListHandler<
  Argv extends BaseListArgv,
  Filter extends ListFilter,
  Item,
  Overview extends ListOverview,
  Cached extends CachedList
>(spec: GitHubListCommandSpec<Argv, Filter, Item, Overview, Cached>): CommandHandler<Argv> {
  return async (argv, logger) => {
    const git = applyRepoFlag(argv)
    // `applyRepoFlag` chdir'd to the repo path (or kept process.cwd when
    // --repo was omitted), so the cache key derives from a stable absolute
    // path either way.
    const repoPath = process.cwd()
    const filter = spec.buildFilter(argv)

    const cacheEnabled = argv.cache !== false
    let items: Item[] | undefined
    let fromCache = false
    let cacheAgeMs: number | undefined

    // Repository metadata is needed for the header in both paths (cache hit
    // and fresh fetch). The cache hit path skips the fetch entirely, so probe
    // it directly here — cheap, just a single `git remote` parse. The detected
    // provider also routes the fetch to the right forge CLI.
    const repository = await getProviderRepositoryForGit(git)
    const provider = repository?.provider

    if (cacheEnabled && !argv.refresh) {
      const cached = readCachedList<Cached>(spec.kind, repoPath, filter)
      if (cached?.fresh) {
        items = cached.payload.items as Item[]
        fromCache = true
        cacheAgeMs = cached.ageMs
      }
    }

    if (!items) {
      const overview = await spec.fetch(git, filter, provider)

      if (!overview.available) {
        logger.log(chalk.red(overview.message || 'No supported remote (GitHub or GitLab) detected.'))
        commandExit(1)
        return
      }

      if (!overview.authenticated) {
        logger.log(chalk.yellow(overview.message || 'No authenticated forge CLI detected.'))
        logger.log(
          chalk.dim(
            `Authenticate the matching CLI (GitHub \`gh\` or GitLab \`glab\`) to enable ${spec.triageLabel}.`
          )
        )
        commandExit(1)
        return
      }

      if (overview.message) {
        logger.log(chalk.red(overview.message))
        commandExit(1)
        return
      }

      items = spec.extractItems(overview) || []

      if (cacheEnabled) {
        writeCachedList(repoPath, filter, spec.toCachePayload(items))
      }
    }

    if (argv.json) {
      emitJson(items)
      return
    }

    const listNoun =
      provider === 'gitlab' && spec.gitlabNoun ? spec.gitlabNoun : spec.noun

    if (repository?.owner && repository?.name) {
      const filterParts = spec.summarizeFilter(filter)
      const suffix = filterParts.length ? chalk.dim(` (${filterParts.join(', ')})`) : ''
      const cacheTag =
        fromCache && typeof cacheAgeMs === 'number'
          ? chalk.dim(` · cached ${Math.round(cacheAgeMs / 1000)}s ago`)
          : ''
      logger.log(
        chalk.bold(`${repository.owner}/${repository.name}`) +
          chalk.dim(` · ${items.length} ${listNoun}${items.length === 1 ? '' : 's'}`) +
          suffix +
          cacheTag
      )
      logger.log('')
    }

    logger.log(spec.formatList(items, listNoun))
  }
}
