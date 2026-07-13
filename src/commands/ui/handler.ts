import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import { LogArgv, LogOptions } from '../log/config'
import { GitLogRow, getLogRows } from '../../git/logData'
import { getStashCommitHashes } from '../../git/stashData'
import { startInkInteractiveLog } from '../../workstation/runtime/inkRuntime'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { readCachedCommits, writeCachedCommits } from '../../workstation/chrome/overviewCache'
import { LogInkThemeConfig } from '../../workstation/chrome/theme'
import { UiArgv } from './config'

export function createLogArgvFromUiArgv(argv: UiArgv): LogArgv {
  return {
    $0: argv.$0,
    _: ['log'],
    // Pass `--all` through from the CLI. The yargs default is `true`
    // since 0.54.x — user feedback consistently asked for the
    // GitKraken-style "see all branches, tags, stashes" view as the
    // starting state. `coco ui --no-all` opts back to
    // current-branch-only.
    //
    // `?? true` re-asserts that default for the synthetic-argv path:
    // bare `coco` routes through defaultRouteHandler → buildSyntheticArgv,
    // which bypasses yargs and so never applies the `default: true` from
    // ui/config.ts — leaving `argv.all` undefined (#1169). Without the
    // fallback the workstation booted in compact (`--first-parent
    // --no-merges`) mode: fewer commits, branches "ahead" of HEAD hidden,
    // and cursoring/checking-out a branch whose tip wasn't in the compact
    // window triggered an anchored-context append that looped the graph
    // back to the initial commit. Explicit `--no-all` (argv.all === false)
    // is preserved because `false ?? true === false`.
    //
    // Note: passing `--branch foo` does NOT automatically scope away
    // from --all. If the user wants strictly that branch, they pass
    // `coco ui --branch foo --no-all`. We considered the implicit
    // scope-narrowing but it surprises users who pass `--branch` as
    // a "highlight this branch in the all-refs view" hint.
    all: argv.all ?? true,
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

/**
 * Resolve which theme to apply for the workstation. CLI `--theme`
 * overrides the config's preset; otherwise we pass through the
 * config's `logTui.theme` block (or `undefined` if none is set, to
 * let the chrome layer pick the default preset).
 *
 * Exported for unit testing — the merge/override logic is small but
 * easy to break (e.g. accidentally overwriting the entire theme
 * block instead of just the preset).
 */
export function createUiTheme(config: Config, argv: UiArgv): LogInkThemeConfig | undefined {
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

/**
 * Workstation-aware log loader (#1034 follow-up). Calls `git stash
 * list` first to collect every stash's commit hash, then passes them
 * as extra refs to `getLogRows` so the graph includes every stash as
 * a node — not just the latest (which is the only one `refs/stash`
 * points at and the only one `git log --all` walks).
 *
 * Without this, the stash → history cursor sync added in #1034 only
 * worked for `stash@{0}`; cursoring any older stash row reported
 * "tip not in loaded window" because that stash's commit hash was
 * never in the loaded graph window in the first place.
 *
 * The extra git call is cheap (one `git stash list --format=%H`,
 * usually sub-50ms). It's only an additive cost when stashes exist;
 * users on stash-free repos pay nothing.
 */
async function loadRowsWithStashes(
  git: SimpleGit,
  logArgv: LogArgv
): Promise<GitLogRow[]> {
  const stashHashes = await getStashCommitHashes(git).catch(() => [])
  return getLogRows(git, logArgv, { extraRefs: stashHashes })
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
    : withCacheWrite(repoPath, () => loadRowsWithStashes(git, logArgv))

  await startInkInteractiveLog(git, initialRows, {}, {
    appLabel: 'coco',
    idleTips: config.logTui?.idleTips,
    dateBucketing: config.logTui?.dateBucketing,
    syntaxHighlight: config.logTui?.syntaxHighlight,
    initialView: 'history',
    loadRows,
    logArgv,
    theme: config.logTui?.theme,
  })
}

export async function startCocoUi(argv: UiArgv): Promise<void> {
  // `--repo <dir>` (alias `--cwd`) — apply the global flag via the
  // shared helper. After this returns, `process.cwd()` and the git
  // instance are both bound to the targeted repo, so loadConfig
  // walks the right tree and downstream reads stay consistent.
  const git = applyRepoFlag(argv)
  const repoPath = process.cwd()

  const config = loadConfig<Config, UiArgv>(argv)
  const logArgv = createLogArgvFromUiArgv(argv)

  // Same three-stage boot as startCocoUiFromLogArgv — mount with
  // cached rows for an instant-paint shell, refresh in background.
  const cachedRows = readCachedCommits(repoPath)

  await startInkInteractiveLog(git, cachedRows || [], {}, {
    appLabel: 'coco',
    idleTips: config.logTui?.idleTips,
    dateBucketing: config.logTui?.dateBucketing,
    syntaxHighlight: config.logTui?.syntaxHighlight,
    initialView: argv.view || 'history',
    loadRows: withCacheWrite(repoPath, () => loadRowsWithStashes(git, logArgv)),
    logArgv,
    theme: createUiTheme(config, argv),
  })
}

export const handler: CommandHandler<UiArgv> = async (argv) => {
  await startCocoUi(argv)
}
