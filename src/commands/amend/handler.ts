import chalk from 'chalk'
import { Arguments } from 'yargs'
import { CommandHandler } from '../../lib/types'
import { FileChange } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { generateCommitDraft } from '../commit/generateCommitDraft'
import { CommitOptions } from '../commit/config'
import { getChangesByCommit } from '../../lib/simple-git/getChangesByCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'
import { commandExit } from '../../lib/utils/commandExit'
import { emitJson } from '../../lib/ui/emitJson'
import { isInteractive, LOGO } from '../../lib/ui/helpers'
import { logSuccess } from '../../lib/ui/logSuccess'
import { selectPrompt, editorPrompt } from '../../lib/ui/inquirerPrompts'
import { AmendArgv, AmendOptions } from './config'

export const handler: CommandHandler<AmendArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const config = loadConfig<AmendOptions, AmendArgv>(argv)

  // A dry-run / JSON request is a preview: never enter interactive prompts and
  // never mutate the commit.
  const previewOnly = Boolean(argv.json || argv.dryRun)
  const INTERACTIVE = previewOnly ? false : argv.interactive || isInteractive(config)

  // There must be a commit to amend.
  try {
    await git.revparse(['--verify', 'HEAD'])
  } catch {
    logger.error('No commit to amend — the repository has no commits yet.', { color: 'red' })
    commandExit(1)
    return
  }

  if (INTERACTIVE && !config.hideCocoBanner) {
    logger.log(LOGO)
  }

  const previousMessage = (await git.raw(['log', '-1', '--pretty=%B'])).trim()

  // The amended commit's content is the last commit's diff plus anything
  // currently staged (which `git commit --amend` folds in). Merge by path so
  // the regenerated message reflects the final amended state; staged entries
  // win since they're the newer state of a file.
  const ignoredFiles = config.ignoredFiles || undefined
  const ignoredExtensions = config.ignoredExtensions || undefined
  const headChanges = await getChangesByCommit({
    commit: 'HEAD',
    options: { git, ignoredFiles, ignoredExtensions },
  })
  const { staged } = await getChanges({ git, options: { ignoredFiles, ignoredExtensions } })

  const byPath = new Map<string, FileChange>()
  for (const change of headChanges) byPath.set(change.filePath, change)
  for (const change of staged) byPath.set(change.filePath, change)
  const changes = [...byPath.values()]

  if (changes.length === 0) {
    logger.log('Nothing to summarize for the last commit.', { color: 'yellow' })
    commandExit(1)
    return
  }

  if (staged.length > 0 && INTERACTIVE) {
    logger.log(
      `Note: ${staged.length} staged change${staged.length === 1 ? '' : 's'} will be folded into the amended commit.`,
      { color: 'yellow' }
    )
  }

  const result = await generateCommitDraft({
    git,
    argv: argv as unknown as Arguments<CommitOptions>,
    logger,
    changeSource: { changes, commitRef: 'HEAD' },
  })

  if (!result.ok || !result.draft) {
    for (const warning of result.warnings) logger.log(warning, { color: 'yellow' })
    for (const error of result.validationErrors) logger.error(error, { color: 'red' })
    commandExit(1)
    return
  }

  let message = result.draft

  if (argv.json) {
    emitJson({ previous: previousMessage, message })
    return
  }

  if (argv.dryRun) {
    process.stdout.write(`${message}\n`)
    return
  }

  if (INTERACTIVE) {
    logger.log(chalk.dim('\nCurrent message:'))
    logger.log(chalk.dim(previousMessage))
    logger.log(chalk.bold('\nRegenerated message:'))
    logger.log(message)
    logger.log('')

    const choice = await selectPrompt<'apply' | 'edit' | 'cancel'>({
      message: 'Amend the last commit with this message?',
      choices: [
        { name: '✅ Apply', value: 'apply' },
        { name: '✏️  Edit & apply', value: 'edit' },
        { name: '🚫 Cancel', value: 'cancel' },
      ],
    })

    if (choice === 'cancel') {
      logger.log('Amend cancelled.', { color: 'yellow' })
      commandExit(0)
      return
    }

    if (choice === 'edit') {
      message = (await editorPrompt({ message: 'Edit the commit message', default: message })).trim()
      if (!message) {
        logger.log('Empty message — amend cancelled.', { color: 'yellow' })
        commandExit(0)
        return
      }
    }
  } else if (!argv.apply) {
    process.stdout.write(`${message}\n`)
    return
  }

  try {
    await createCommit(
      message,
      git,
      () => {
        logger.log('Pre-commit hook modified files; re-staging and retrying…', { color: 'yellow' })
      },
      { amend: true, noVerify: argv.noVerify }
    )
  } catch (error) {
    if (error instanceof PreCommitHookError) {
      logger.error('Amend blocked by a git hook:', { color: 'red' })
      logger.log(error.hookOutput, { color: 'gray' })
      commandExit(1)
      return
    }
    throw error
  }

  if (INTERACTIVE) {
    logSuccess()
  } else {
    process.stdout.write(`${message}\n`)
  }
}
