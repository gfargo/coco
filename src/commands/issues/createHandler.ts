import chalk from 'chalk'
import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getProviderOverview } from '../../git/providerData'
import { getForgeActions } from '../../git/forgeActions'
import { commandExit } from '../../lib/utils/commandExit'
import { emitJson } from '../../lib/ui/emitJson'
import { isInteractive, LOGO } from '../../lib/ui/helpers'
import { selectPrompt, editorPrompt } from '../../lib/ui/inquirerPrompts'
import { ReviewFeedbackItem, ReviewFeedbackItemArraySchema } from '../review/config'
import { IssuesCreateArgv, IssuesCreateOptions } from './createConfig'
import { findingToIssue } from './findingToIssue'

function splitTitleBody(text: string): { title: string; body: string } {
  const trimmed = text.trim()
  const blankIdx = trimmed.indexOf('\n\n')
  if (blankIdx > 0) {
    return { title: trimmed.slice(0, blankIdx).trim(), body: trimmed.slice(blankIdx + 2).trim() }
  }
  return { title: trimmed.split('\n')[0].trim(), body: '' }
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  const chunks: string[] = []
  for await (const chunk of process.stdin) chunks.push(String(chunk))
  return chunks.join('')
}

export const handler: CommandHandler<IssuesCreateArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const config = loadConfig<IssuesCreateOptions, IssuesCreateArgv>(argv)

  const previewOnly = Boolean(argv.json || argv.dryRun)
  const INTERACTIVE = previewOnly ? false : argv.interactive || isInteractive(config)

  const overview = await getProviderOverview(git)
  const provider = overview.repository.provider

  if (
    provider !== 'github' &&
    provider !== 'gitlab' &&
    provider !== 'bitbucket' &&
    provider !== 'gitea' &&
    provider !== 'azure-devops'
  ) {
    logger.error(
      overview.repository.message ||
        'No supported remote (GitHub, GitLab, Bitbucket, Gitea, or Azure DevOps) detected.',
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

  if (INTERACTIVE && !config.hideCocoBanner) {
    logger.log(LOGO)
  }

  let title = argv.title?.trim() || ''
  let body = argv.body?.trim() || ''

  // Per-field merge: --from-review only fills in whichever of title/body
  // wasn't explicitly passed, so supplying just --title still drafts a body
  // from the piped finding (and vice versa). Pass both to skip stdin.
  if ((!title || !body) && argv.fromReview) {
    const raw = (await readStdin()).trim()
    if (!raw) {
      logger.error(
        '--from-review requires review findings JSON on stdin — pipe `coco review --json`.',
        { color: 'red' }
      )
      commandExit(1)
      return
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      logger.error('Could not parse stdin as JSON — pipe the output of `coco review --json`.', { color: 'red' })
      commandExit(1)
      return
    }

    const parsed = ReviewFeedbackItemArraySchema.safeParse(parsedJson)
    if (!parsed.success || parsed.data.length === 0) {
      logger.error('No review findings found on stdin — pipe the output of `coco review --json`.', { color: 'red' })
      commandExit(1)
      return
    }

    const findings = [...parsed.data].sort((a, b) => b.severity - a.severity)

    // stdin was just fully drained to read the findings above, so it's not a
    // TTY the picker could read keystrokes from — only offer it when stdin
    // itself is interactive (findings piped in some other way, e.g. tests).
    let selected = findings[0]
    if (findings.length > 1 && INTERACTIVE && process.stdin.isTTY) {
      selected = await selectPrompt<ReviewFeedbackItem>({
        message: 'Which finding should become an issue?',
        choices: findings.map((finding) => ({
          name: `[${finding.severity}] ${finding.title} (${finding.filePath})`,
          value: finding,
        })),
      })
    }

    const drafted = findingToIssue(selected)
    title = title || drafted.title
    body = body || drafted.body
  }

  if (!title) {
    logger.error('Could not determine an issue title. Pass --title or --from-review.', { color: 'red' })
    commandExit(1)
    return
  }

  if (argv.json) {
    emitJson({ title, body })
    return
  }

  if (argv.dryRun) {
    logger.log(`${title}\n\n${body}`)
    return
  }

  if (INTERACTIVE) {
    logger.log(chalk.bold('\nTitle:'))
    logger.log(title)
    logger.log(chalk.bold('\nBody:'))
    logger.log(body || chalk.dim('(empty)'))
    logger.log('')

    const choice = await selectPrompt<'create' | 'edit' | 'cancel'>({
      message: 'Create this issue?',
      choices: [
        { name: '✅ Create', value: 'create' },
        { name: '✏️  Edit & create', value: 'edit' },
        { name: '🚫 Cancel', value: 'cancel' },
      ],
    })

    if (choice === 'cancel') {
      logger.log('Issue creation cancelled.', { color: 'yellow' })
      commandExit(0)
      return
    }

    if (choice === 'edit') {
      const edited = await editorPrompt({
        message: 'Edit the issue (first line is the title, blank line, then body)',
        default: `${title}\n\n${body}`,
      })
      const reparsed = splitTitleBody(edited)
      if (!reparsed.title) {
        logger.log('Empty title — issue creation cancelled.', { color: 'yellow' })
        commandExit(0)
        return
      }
      title = reparsed.title
      body = reparsed.body
    }
  }

  const repoPath =
    overview.repository.owner && overview.repository.name
      ? `${overview.repository.owner}/${overview.repository.name}`
      : undefined
  const forge = getForgeActions(provider, {
    gitlabPath: repoPath,
    gitlabHost: overview.repository.host,
    bitbucketPath: repoPath,
    giteaPath: repoPath,
    giteaHost: overview.repository.host,
    azureDevOpsPath: repoPath,
    azureDevOpsHost: overview.repository.host,
  })

  const result = await forge.createIssue({ title, body })

  if (!result.ok) {
    logger.error(result.message, { color: 'red' })
    for (const detail of result.details || []) logger.log(detail, { color: 'gray' })
    commandExit(1)
    return
  }

  logger.log(result.message, { color: 'green' })
}
