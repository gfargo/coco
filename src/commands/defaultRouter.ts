/**
 * Default-command router for `coco` invoked with no positional
 * arguments. Decides where to send the user based on the state of
 * their machine:
 *
 *   ┌─────────────────────────┬─────────────────────┬──────────────┐
 *   │ Config present?         │ In a git repo?      │ Action       │
 *   ├─────────────────────────┼─────────────────────┼──────────────┤
 *   │ No (default-only)       │ —                   │ run `init`   │
 *   │ Yes                     │ Yes (worktree)      │ run `ui`     │
 *   │ Yes                     │ No                  │ run `ws`     │
 *   └─────────────────────────┴─────────────────────┴──────────────┘
 *
 * The pre-existing default — fall through to `commit` — was hostile
 * to first-time users: a fresh install with no config landed
 * straight in the API-key error path, with no hint that `coco init`
 * was the right next step. Routing fresh installs to `init` and
 * configured users to the workstation/UI matches what every other
 * git-aware CLI does (lazygit, tig, gitui all open their TUI on bare
 * invocation).
 *
 * `coco commit` keeps its dedicated subcommand entry so existing
 * scripts (`git aliases`, hook integrations, CI jobs) that call
 * `coco commit` continue to work unchanged.
 *
 * The router is a thin shim — it forwards to the existing handlers
 * via their public exports rather than re-implementing the logic.
 */


import { Arguments } from 'yargs'

import { CommandExitError } from '../lib/utils/commandExit'
import { CommandHandler } from '../lib/types'

import { handler as commitHandler } from './commit/handler'
import { handler as initHandler } from './init/handler'
import { handler as uiHandler } from './ui/handler'
import { handler as workspaceHandler } from './workspace/handler'

import { getConfigSources, loadConfig } from '../lib/config/utils/loadConfig'
import { applyRepoCwd } from './utils/applyRepoFlag'

import { CommitArgv } from './commit/config'
import { InitArgv } from './init/config'
import { UiArgv } from './ui/config'
import { WorkspaceArgv } from './workspace/config'

/**
 * Argv shape the default router receives. Loose-typed because yargs
 * routes everything through the `$0` command's argv contract; we
 * narrow into per-command argv shapes when forwarding.
 */
export interface DefaultRouteOptions {
  interactive: boolean
  verbose: boolean
  version: boolean
  help: boolean
  repo?: string
  cwd?: string
  /**
   * Escape hatch — any user who explicitly wants the legacy
   * "default to commit" behavior can pass `--commit` (or set
   * `COCO_DEFAULT=commit` in their env). Lets script integrations
   * stay unsurprised by the routing change while still letting
   * interactive users land in the more helpful default.
   */
  commit?: boolean
}

export type DefaultRouteArgv = Arguments<DefaultRouteOptions>

/**
 * Decision the router makes after probing the user's environment.
 * Exposed for tests so the routing logic stays asserted as data,
 * not as side effects of the dispatcher.
 */
export type DefaultRouteDecision =
  | { kind: 'init'; reason: 'no-config' }
  | { kind: 'ui'; reason: 'config-and-repo' }
  | { kind: 'workspace'; reason: 'config-no-repo' }
  | { kind: 'commit'; reason: 'explicit-flag' | 'env-override' }

/**
 * Pure decision function — given probed signals (whether config
 * exists, whether the current directory is a git repo, whether the
 * user opted into legacy commit-by-default), decides which command
 * to invoke. Kept pure so unit tests can cover every quadrant of
 * the router table without spawning processes.
 *
 * "Config exists" is defined as: the loader detected at least one
 * source beyond `default` — i.e., the user has either a project
 * config, a git config `[coco]` section, an env var, or an XDG
 * config. A pure-defaults run is treated as "never been configured"
 * because `coco init` is the only way to populate any of those
 * sources.
 */
export function decideDefaultRoute(input: {
  hasConfigSource: boolean
  isGitRepo: boolean
  explicitCommit: boolean
  envOverride?: string
}): DefaultRouteDecision {
  if (input.envOverride === 'commit' || input.explicitCommit) {
    return {
      kind: 'commit',
      reason: input.envOverride === 'commit' ? 'env-override' : 'explicit-flag',
    }
  }
  if (!input.hasConfigSource) {
    return { kind: 'init', reason: 'no-config' }
  }
  if (input.isGitRepo) {
    return { kind: 'ui', reason: 'config-and-repo' }
  }
  return { kind: 'workspace', reason: 'config-no-repo' }
}

/**
 * Probe whether the cwd (after `--repo` is honored) is inside a git
 * worktree. Tolerant of every error class — a thrown simple-git
 * call should never block the router; it should fall back to
 * "not a repo" so the user lands somewhere sensible (workspace
 * surface) rather than crashing on an empty machine.
 */
async function probeIsGitRepo(): Promise<boolean> {
  try {
    // Lazy-import simple-git so the cold-start path stays fast for
    // users running `coco --help` / `coco doctor` etc.
    const { default: simpleGit } = await import('simple-git')
    const git = simpleGit()
    return await git.checkIsRepo()
  } catch {
    return false
  }
}

/**
 * Build a synthetic argv for one of the targeted handlers. Each
 * handler reads its own typed argv contract (`CommitArgv`,
 * `InitArgv`, `UiArgv`, `WorkspaceArgv`) so we can't just spread the
 * raw default argv — we have to project the shared fields and let
 * the handler fill in command-specific defaults.
 *
 * Exported for testing: this is the path bare `coco` takes to the
 * workstation, and it intentionally does NOT set `all` — yargs's
 * `default: true` for `coco ui` never runs here, so the ui→log argv
 * mapping has to re-assert that default (#1169).
 *
 * `interactive` defaults to `true` (the `ui`/`workspace`/`init`
 * routes all expect it), but callers can override it — the legacy
 * `commit` route needs to inherit normal mode resolution instead of
 * being forced into interactive mode (#1442).
 */
export function buildSyntheticArgv<T>(
  argv: DefaultRouteArgv,
  overrides: Partial<{ interactive: boolean }> = {}
): T {
  return ({
    _: ['$0'],
    $0: argv.$0,
    repo: argv.repo,
    cwd: argv.cwd,
    verbose: argv.verbose,
    interactive: true,
    version: false,
    help: false,
    ...overrides,
  } as unknown) as T
}

/**
 * Default-command handler installed under yargs's `$0` slot. Probes
 * the environment, computes the right route, and forwards to the
 * matching command handler. Falls through to commit if any
 * unexpected error blocks routing — preserves backwards-compat
 * for users on weird setups while still giving newcomers the
 * onboarding path they deserve.
 */
export const defaultRouteHandler: CommandHandler<DefaultRouteArgv> = async (
  argv,
  logger
) => {
  // The `--repo` flag has to land before any probe runs — otherwise
  // we'd sniff the launcher's cwd instead of the targeted repo.
  applyRepoCwd(argv)

  // Trigger a config load so `getConfigSources()` returns the active
  // source list. We discard the config object — the decision only
  // cares about which sources contributed.
  void loadConfig(argv)
  const sources = getConfigSources()
  const hasConfigSource = sources.some((source) => source.source !== 'default')

  const isGitRepo = await probeIsGitRepo()

  const decision = decideDefaultRoute({
    hasConfigSource,
    isGitRepo,
    explicitCommit: Boolean(argv.commit),
    envOverride: process.env.COCO_DEFAULT,
  })

  switch (decision.kind) {
    case 'init':
      // Friendly hint before the wizard kicks in — sets expectations
      // that the user is being walked through setup, not silently
      // routed to a different command.
      logger.log('No coco config detected — running `coco init` to set up your provider + key.', { color: 'cyan' })
      logger.log('')
      await initHandler(buildSyntheticArgv<InitArgv>(argv), logger)
      return
    case 'ui':
      await uiHandler(buildSyntheticArgv<UiArgv>(argv), logger)
      return
    case 'workspace':
      await workspaceHandler(buildSyntheticArgv<WorkspaceArgv>(argv), logger)
      return
    case 'commit':
    default:
      // Don't force interactive mode here — the legacy escape hatch
      // promises scripts the same stdout-by-default behavior as
      // `coco commit`, so let commitHandler's own
      // `argv.interactive || isInteractive(config)` resolution decide (#1442).
      await commitHandler(
        buildSyntheticArgv<CommitArgv>(argv, { interactive: Boolean(argv.interactive) }),
        logger
      )
      return
  }
}

/**
 * Re-export `CommandExitError` so callers (tests, the launcher) can
 * import the router and the exit shape from one place without
 * crossing into `lib/utils`.
 */
export { CommandExitError }
