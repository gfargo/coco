import * as path from 'node:path'
import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import { LogArgv, LogOptions } from '../log/config'
import { GitLogRow, getLogRows } from '../log/data'
import { startInkInteractiveLog } from '../log/inkRuntime'
import { readCachedCommits, writeCachedCommits } from '../../workstation/chrome/overviewCache'
import { LogInkThemeConfig } from '../../workstation/chrome/theme'
import { UiArgv } from './config'

export function createLogArgvFromUiArgv(argv: UiArgv): LogArgv {
  return {
    $0: argv.$0,
    _: ['log'],
    all: argv.all,
    branch: argv.branch,
    format: 'table',
    interactive: true,
    limit: argv.limit,
    path: argv.path,
    // Carry the --repo flag through so the runtime keeps the same
    // repo target across the ui → log argv handoff.
    repo: argv.repo,
    verbose: argv.verbose,
    version: argv.version,
    help: argv.help,
  } as Arguments<LogOptions>
}

function createUiTheme(config: Config, argv: UiArgv): LogInkThemeConfig | undefined {
  if (!argv.theme) {
    return config.logTui?.theme
  }

  return {
    ...config.logTui?.theme,
    preset: argv.theme,
  }
}

type StartCocoUiFromLogArgvOptions = {
  config?: Config
  git?: SimpleGit
  rows?: GitLogRow[]
}

/**
 * Wrap a fresh-rows loader with the disk-cache write step. Lets the
 * runtime stay caching-agnostic — it just receives the rows and
 * doesn't know whether they came from cache or git, while the caller
 * (which knows the repo path) handles persistence.
 */
function withCacheWrite(
  repoPath: string,
  loader: () => Promise<GitLogRow[]>
): () => Promise<GitLogRow[]> {
  return async () => {
    const rows = await loader()
    writeCachedCommits(repoPath, rows)
    return rows
  }
}

export async function startCocoUiFromLogArgv(
  logArgv: LogArgv,
  options: StartCocoUiFromLogArgvOptions = {}
): Promise<void> {
  const config = options.config || loadConfig<Config, LogArgv>(logArgv)
  const git = options.git || getRepo()
  const repoPath = process.cwd()

  // Three-stage boot (#808):
  //   1. Read the disk cache and pass cached rows as the initial set
  //      so the user sees the workstation chrome populated with
  //      commits in the first frame.
  //   2. Mount Ink immediately with those rows (or [] if no cache).
  //   3. Run loadRows in the background to refresh — when fresh data
  //      lands the runtime swaps it in transparently and we persist
  //      the new rows back to the cache for next boot.
  // Caller-provided rows skip the lazy path entirely (caller already
  // has up-to-date data — no point redoing the fetch).
  const cachedRows = options.rows ? undefined : readCachedCommits(repoPath)
  const initialRows = options.rows || cachedRows || []
  const loadRows = options.rows
    ? undefined
    : withCacheWrite(repoPath, () => getLogRows(git, logArgv))

  await startInkInteractiveLog(git, initialRows, {}, {
    appLabel: 'coco',
    idleTips: config.logTui?.idleTips,
    initialView: 'history',
    loadRows,
    logArgv,
    theme: config.logTui?.theme,
  })
}

export async function startCocoUi(argv: UiArgv): Promise<void> {
  // `--repo <dir>` (alias `--cwd`) lets users target an arbitrary
  // repository without `cd`-ing first. Resolve to absolute up-front
  // so:
  //   1. process.chdir gets a stable path (relative paths against
  //      the original cwd would surprise the user if any later code
  //      reads cwd after the chdir).
  //   2. The disk cache key (rooted at repoPath) is canonical.
  //   3. simple-git's baseDir is unambiguous.
  // When the flag is omitted, fall back to process.cwd() — original
  // behavior, no surprise for users who launch via `cd && coco ui`.
  const repoPath = argv.repo ? path.resolve(argv.repo) : process.cwd()

  // chdir BEFORE loadConfig so .coco.config.json lookup walks up
  // from the targeted repo, not from wherever the user ran coco
  // from. Many config-resolution paths (lib/utils/findUp, etc.)
  // read process.cwd() — keeping them honest means doing the chdir
  // up-front rather than passing a path everywhere.
  if (argv.repo) {
    process.chdir(repoPath)
  }

  const config = loadConfig<Config, UiArgv>(argv)
  const git = getRepo(repoPath)
  const logArgv = createLogArgvFromUiArgv(argv)

  // Same three-stage boot as startCocoUiFromLogArgv — mount with
  // cached rows for an instant-paint shell, refresh in background.
  const cachedRows = readCachedCommits(repoPath)

  await startInkInteractiveLog(git, cachedRows || [], {}, {
    appLabel: 'coco',
    idleTips: config.logTui?.idleTips,
    initialView: argv.view || 'history',
    loadRows: withCacheWrite(repoPath, () => getLogRows(git, logArgv)),
    logArgv,
    theme: createUiTheme(config, argv),
  })
}

export const handler: CommandHandler<UiArgv> = async (argv) => {
  await startCocoUi(argv)
}
