import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getProviderOverview } from '../../git/providerData'
import { runPullRequestBodyWorkflow } from '../../git/aiActions'
import { createPullRequest, openPullRequest } from '../../git/pullRequestActions'
import { createMergeRequest, openMergeRequest } from '../../git/mergeRequestActions'
import { createBitbucketPullRequest, openBitbucketPullRequest } from '../../git/bitbucketPullRequestActions'
import { forgeNouns } from '../../workstation/chrome/forgeNouns'
import { commandExit } from '../../lib/utils/commandExit'
import { emitJson } from '../../lib/ui/emitJson'
import { isInteractive, LOGO } from '../../lib/ui/helpers'
import { selectPrompt, editorPrompt } from '../../lib/ui/inquirerPrompts'
import { PrCreateArgv, PrCreateOptions } from './config'

function splitTitleBody(text: string): { title: string; body: string } {
  const trimmed = text.trim()
  const blankIdx = trimmed.indexOf('\n\n')
  if (blankIdx > 0) {
    return { title: trimmed.slice(0, blankIdx).trim(), body: trimmed.slice(blankIdx + 2).trim() }
  }
  return { title: trimmed.split('\n')[0].trim(), body: '' }
}

export const handler: CommandHandler<PrCreateArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const config = loadConfig<PrCreateOptions, PrCreateArgv>(argv)

  const previewOnly = Boolean(argv.json || argv.dryRun)
  const INTERACTIVE = previewOnly ? false : argv.interactive || isInteractive(config)

  const overview = await getProviderOverview(git)
  const provider = overview.repository.provider
  const nouns = forgeNouns(provider)

  if (provider !== 'github' && provider !== 'gitlab' && provider !== 'bitbucket') {
    logger.error(
      overview.repository.message || 'No supported remote (GitHub, GitLab, or Bitbucket) detected.',
      { color: 'red' }
    )
    commandExit(1)
    return
  }

  if (!overview.authenticated) {
    // `getProviderOverview` already routes through the forge's auth probe, so
    // this is the curated "install / authenticate the CLI" recovery hint.
    logger.log(overview.message || 'The forge CLI is unavailable.', { color: 'yellow' })
    commandExit(1)
    return
  }

  const head = overview.currentBranch
  if (!head) {
    logger.error('Could not determine the current branch (detached HEAD?).', { color: 'red' })
    commandExit(1)
    return
  }

  const base = argv.base || overview.repository.defaultBranch || 'main'
  if (head === base) {
    logger.log(
      `You're on the base branch ('${base}'). Check out a feature branch before creating a ${nouns.abbrev}.`,
      { color: 'yellow' }
    )
    commandExit(1)
    return
  }

  if (overview.currentPullRequest) {
    logger.log(
      `A ${nouns.singularLower} already exists for '${head}': #${overview.currentPullRequest.number} (${overview.currentPullRequest.state}).`,
      { color: 'yellow' }
    )
    commandExit(0)
    return
  }

  if (INTERACTIVE && !config.hideCocoBanner) {
    logger.log(LOGO)
  }

  // Title/body: explicit flags win; otherwise generate from the branch diff via
  // the same changelog chain the in-TUI "create PR" workflow uses.
  let title = argv.title?.trim() || ''
  let body = argv.body?.trim() || ''

  if (!title || !body) {
    const generated = await runPullRequestBodyWorkflow({ baseBranch: base })
    if (!generated.ok) {
      logger.error(generated.message || `Failed to generate a ${nouns.singularLower} body.`, { color: 'red' })
      commandExit(1)
      return
    }
    title = title || (generated.title || '').trim()
    body = body || (generated.body || '').trim()
  }

  if (!title) {
    logger.error(`Could not produce a ${nouns.singularLower} title.`, { color: 'red' })
    commandExit(1)
    return
  }

  if (argv.json) {
    emitJson({ base, head, title, body, draft: Boolean(argv.draft) })
    return
  }

  if (argv.dryRun) {
    logger.log(`${title}\n\n${body}`)
    return
  }

  if (INTERACTIVE) {
    logger.log(chalk.bold(`\n${head} → ${base}${argv.draft ? ' (draft)' : ''}`))
    logger.log(chalk.bold('\nTitle:'))
    logger.log(title)
    logger.log(chalk.bold('\nBody:'))
    logger.log(body || chalk.dim('(empty)'))
    logger.log('')

    const choice = await selectPrompt<'create' | 'edit' | 'cancel'>({
      message: `Create this ${nouns.singularLower}?`,
      choices: [
        { name: '✅ Create', value: 'create' },
        { name: '✏️  Edit & create', value: 'edit' },
        { name: '🚫 Cancel', value: 'cancel' },
      ],
    })

    if (choice === 'cancel') {
      logger.log(`${nouns.singular} creation cancelled.`, { color: 'yellow' })
      commandExit(0)
      return
    }

    if (choice === 'edit') {
      const edited = await editorPrompt({
        message: 'Edit the PR (first line is the title, blank line, then body)',
        default: `${title}\n\n${body}`,
      })
      const reparsed = splitTitleBody(edited)
      if (!reparsed.title) {
        logger.log(`Empty title — ${nouns.singularLower} creation cancelled.`, { color: 'yellow' })
        commandExit(0)
        return
      }
      title = reparsed.title
      body = reparsed.body
    }
  }

  const input = { base, head, title, body, draft: Boolean(argv.draft) }
  const repoPath =
    overview.repository.owner && overview.repository.name
      ? `${overview.repository.owner}/${overview.repository.name}`
      : undefined

  let result
  if (provider === 'gitlab') {
    result = await createMergeRequest(input)
  } else if (provider === 'bitbucket' && repoPath) {
    result = await createBitbucketPullRequest(repoPath, input)
  } else {
    result = await createPullRequest(input)
  }

  if (!result.ok) {
    logger.error(result.message, { color: 'red' })
    for (const detail of result.details || []) logger.log(detail, { color: 'gray' })
    commandExit(1)
    return
  }

  logger.log(result.message, { color: 'green' })

  if (argv.web && result.url) {
    if (provider === 'gitlab') {
      await openMergeRequest(result.url)
    } else if (provider === 'bitbucket') {
      openBitbucketPullRequest(result.url)
    } else {
      await openPullRequest(result.url)
    }
  }
}
