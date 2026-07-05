import { Logger } from '../utils/logger'
import { SEPERATOR } from './helpers'
import { selectPrompt } from './inquirerPrompts'

export type HookFailureRecoveryChoice = 'retry' | 'skip' | 'abort'

/**
 * Shared pre-commit-hook-failure UX for `coco commit` and `coco commit
 * --split`: logs the hook's raw output under a `header` identifying
 * what was blocked, then — when interactive — prompts the user to
 * retry / skip hooks / abort. Non-interactive callers get the same
 * output but no prompt (there's no TTY to answer it), so the choice
 * defaults to `'abort'` after logging a one-shot recovery hint.
 */
export async function promptHookFailureRecovery({
  logger,
  header,
  hookOutput,
  interactive,
}: {
  logger: Logger
  header: string
  hookOutput: string
  interactive: boolean
}): Promise<HookFailureRecoveryChoice> {
  logger.error(`\n${header}`, { color: 'red' })
  logger.log('\nHook output:', { color: 'yellow' })
  logger.log(SEPERATOR)
  logger.log(hookOutput)
  logger.log(SEPERATOR)

  if (!interactive) {
    logger.error(
      '\nFix the issues above and try again, or use --no-verify to skip hooks.',
      { color: 'yellow' }
    )
    return 'abort'
  }

  return selectPrompt<HookFailureRecoveryChoice>({
    message: 'How would you like to proceed?',
    choices: [
      {
        name: '🔄 Retry',
        value: 'retry',
        description: 'Fix the issues above and retry the commit',
      },
      {
        name: '⚠️  Skip hooks',
        value: 'skip',
        description: 'Retry with --no-verify to bypass pre-commit hooks (use with care)',
      },
      {
        name: '💣 Abort',
        value: 'abort',
        description: 'Abort the commit',
      },
    ],
  })
}
