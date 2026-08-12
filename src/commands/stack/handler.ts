import { CommandHandler } from '../../lib/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { buildStack, getAllStackParents } from '../../git/stackData'
import { createStackedBranch } from '../../git/stackActions'
import { checkoutBranchByName } from '../../git/branchActions'
import { rebaseOnto } from '../../git/rebaseActions'
import { commandExit } from '../../lib/utils/commandExit'
import { emitJson } from '../../lib/ui/emitJson'
import { StackArgv } from './config'

type RestackStatus = 'ok' | 'failed' | 'skipped'

type RestackResult = {
  branch: string
  parent: string
  status: RestackStatus
  message?: string
}

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

/**
 * Sequentially rebase each descendant branch in the stack onto its
 * (possibly-moved) parent via the non-interactive `rebaseOnto` primitive.
 * Walks root→tip (the order `buildStack` already returns), skipping the
 * root entry itself since it has no parent to rebase onto.
 *
 * Stops on the first failure — leaving the repo in git's mid-rebase state,
 * exactly as `rebaseOnto` already does by design (see rebaseActions.ts) —
 * and marks every remaining branch `skipped` rather than attempting them.
 * Deliberately does not add `--continue` / `--abort` handling here; that's
 * out of scope until `coco resolve` exists.
 */
async function handleRestack(argv: StackArgv, git: ReturnType<typeof applyRepoFlag>, logger: Parameters<CommandHandler<StackArgv>>[1]): Promise<void> {
  const currentBranch = (await git.raw(['branch', '--show-current'])).trim()
  if (!currentBranch) {
    logger.error('Could not determine the current branch (detached HEAD?).', { color: 'red' })
    commandExit(1)
    return
  }

  const parents = await getAllStackParents(git)
  const stack = await buildStack(git, currentBranch, parents)

  if (stack.length <= 1 && !stack[0]?.parent) {
    if (argv.json) {
      emitJson({ ok: true, results: [] })
    } else {
      logger.log(`${currentBranch} is not part of a stack — nothing to restack.`)
    }
    return
  }

  const results: RestackResult[] = []
  let failedBranch: string | undefined

  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i]
    if (i === 0 || !entry.parent) continue // root — no parent to rebase onto

    if (failedBranch) {
      results.push({ branch: entry.branch, parent: entry.parent, status: 'skipped' })
      continue
    }

    const checkout = await checkoutBranchByName(git, entry.branch)
    if (!checkout.ok) {
      results.push({ branch: entry.branch, parent: entry.parent, status: 'failed', message: checkout.message })
      failedBranch = entry.branch
      continue
    }

    const rebase = await rebaseOnto(git, entry.parent)
    results.push({ branch: entry.branch, parent: entry.parent, status: rebase.ok ? 'ok' : 'failed', message: rebase.message })
    if (!rebase.ok) failedBranch = entry.branch
  }

  if (argv.json) {
    emitJson({ ok: !failedBranch, results })
  } else {
    for (const result of results) {
      if (result.status === 'ok') {
        logger.log(`✓ ${result.branch} restacked onto ${result.parent}`, { color: 'green' })
      } else if (result.status === 'skipped') {
        logger.log(`- ${result.branch} skipped (halted earlier in the stack)`)
      } else {
        logger.error(`✗ ${result.branch}: ${result.message}`, { color: 'red' })
      }
    }
    if (failedBranch) {
      logger.error(
        `Restack halted on ${failedBranch}. Resolve the in-progress rebase (see the gx conflicts view or run the abort-operation action), then re-run coco stack restack.`,
        { color: 'red' }
      )
    }
  }

  if (failedBranch) commandExit(1)
}

export const handler: CommandHandler<StackArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  if (argv.action === 'create') {
    await handleCreate(argv, git, logger)
    return
  }

  if (argv.action === 'restack') {
    await handleRestack(argv, git, logger)
    return
  }

  await handleStatus(git, argv, logger)
}
