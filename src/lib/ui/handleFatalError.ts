import chalk from 'chalk'

import { isCommandExitError } from '../utils/commandExit'
import { FAIL } from './glyphs'

/** Where unexpected-crash copy points users to file a report. */
const ISSUE_URL = 'https://github.com/gfargo/coco/issues/new/choose'

/**
 * Whether the fatal handler should print the full stack trace. Read from the
 * raw process args + env rather than parsed yargs argv, because the top-level
 * `main().catch` runs outside (and sometimes before) yargs parsing. Mirrors
 * the global `--verbose` / `-v` flag, plus a `COCO_DEBUG` escape hatch.
 */
export function isFatalDebug(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return argv.includes('--verbose') || argv.includes('-v') || Boolean(env.COCO_DEBUG)
}

/**
 * Last-resort handler for errors that escape `commandExecutor` and reach
 * `main().catch` — yargs setup, the env-driven prefetch, the default router,
 * or anything thrown before a command's own graceful handling kicks in.
 * Returns the exit code so the caller drives `process.exit`.
 *
 * Two cases:
 *   - {@link CommandExitError} — an intentional, already-messaged exit (the
 *     handler that threw it printed the friendly copy). Return its code
 *     silently; printing anything here would double up.
 *   - Anything else — an unexpected crash. Print a short, actionable message
 *     (the cause + how to report it) instead of dumping a raw stack trace as
 *     the user's first impression. The full stack is gated behind
 *     `--verbose` / `COCO_DEBUG` so a plain run stays readable while a bug
 *     report can still include the trace. Doubles as a crash→issue funnel.
 *
 * `write` is injectable for testing; defaults to stderr.
 */
export function handleFatalError(
  error: unknown,
  opts: { debug?: boolean; write?: (line: string) => void } = {}
): number {
  if (isCommandExitError(error)) {
    return error.code
  }

  const debug = opts.debug ?? isFatalDebug()
  const write = opts.write ?? ((line: string) => console.error(line))
  const message = error instanceof Error ? error.message : String(error)

  const lines = [
    '',
    `${FAIL()} ${chalk.bold('coco hit an unexpected error.')}`,
    '',
    chalk.red(message || 'Unknown error'),
    '',
  ]

  if (debug && error instanceof Error && error.stack) {
    lines.push(chalk.dim(error.stack), '')
  } else {
    lines.push(
      chalk.dim('Re-run with --verbose (or COCO_DEBUG=1) to see the full stack trace.'),
      ''
    )
  }

  lines.push(
    `${chalk.bold('Looks like a bug?')} Please report it: ${chalk.cyan(ISSUE_URL)}`,
    chalk.dim('Include the command you ran and the output above.'),
    ''
  )

  write(lines.join('\n'))
  return 1
}
