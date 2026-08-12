import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { buildStack, getAllStackParents } from '../../git/stackData'
import { createStackedBranch } from '../../git/stackActions'
import { commandExit } from '../../lib/utils/commandExit'
import { emitJson } from '../../lib/ui/emitJson'
import { StackArgv } from './config'

async function handleCreate(argv: StackArgv, git: ReturnType<typeof applyRepoFlag>, logger: Parameters<CommandHandler<StackArgv>>[1]): Promise<void> {
  const name = argv.name?.trim()
  if (!name) {
    logger.error('A branch name is required: coco stack create <name>', { color: 'red' })
    commandExit(1)
    return
  }

  const currentBranch = (await git.raw(['branch', '--show-current'])).trim()
  const parent = argv.parent?.trim() || currentBranch
  if (!parent) {
    logger.error('Could not determine a parent branch (detached HEAD?). Pass --parent explicitly.', { color: 'red' })
    commandExit(1)
    return
  }

  const result = await createStackedBranch(git, name, parent)

  if (argv.json) {
    emitJson({ ok: result.ok, message: result.message, branch: name, parent })
  } else if (result.ok) {
    logger.log(result.message, { color: 'green' })
  } else {
    logger.error(result.message, { color: 'red' })
  }

  if (!result.ok) commandExit(1)
}

async function handleStatus(git: ReturnType<typeof applyRepoFlag>, argv: StackArgv, logger: Parameters<CommandHandler<StackArgv>>[1]): Promise<void> {
  const currentBranch = (await git.raw(['branch', '--show-current'])).trim()
  if (!currentBranch) {
    logger.error('Could not determine the current branch (detached HEAD?).', { color: 'red' })
    commandExit(1)
    return
  }

  const parents = await getAllStackParents(git)
  const stack = await buildStack(git, currentBranch, parents)

  if (argv.json) {
    emitJson(stack)
    return
  }

  if (stack.length <= 1 && !stack[0]?.parent) {
    logger.log(`${currentBranch} is not part of a stack.`)
    return
  }

  for (const entry of stack) {
    const marker = entry.branch === currentBranch ? '→' : ' '
    const detail = entry.parent
      ? `(parent: ${entry.parent}, +${entry.ahead}/-${entry.behind})`
      : '(root)'
    logger.log(`${marker} ${entry.branch} ${detail}`)
  }
}

export const handler: CommandHandler<StackArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  if (argv.action === 'create') {
    await handleCreate(argv, git, logger)
    return
  }

  await handleStatus(git, argv, logger)
}
