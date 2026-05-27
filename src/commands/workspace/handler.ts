import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getRepo } from '../../lib/simple-git/getRepo'
import {
  startWorkspace,
  type WorkspaceResumeState,
} from '../../workstation/surfaces/workspace'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { createLogArgvFromUiArgv, startCocoUiFromLogArgv } from '../ui/handler'
import type { UiArgv } from '../ui/config'

import { WorkspaceArgv } from './config'

const DEFAULT_ROOTS = ['~/code']

export function resolveWorkspaceRoots(
  argv: WorkspaceArgv,
  config: Pick<Config, 'workspace'>
): string[] {
  const raw = argv.root
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((entry) => String(entry))
  }
  if (typeof raw === 'string' && raw) {
    return [raw]
  }
  if (config.workspace?.roots && config.workspace.roots.length > 0) {
    return [...config.workspace.roots]
  }
  return [...DEFAULT_ROOTS]
}

export function resolveWorkspaceKnownRepos(
  config: Pick<Config, 'workspace'>
): string[] {
  return config.workspace?.knownRepos ? [...config.workspace.knownRepos] : []
}

export function resolveWorkspaceMaxDepth(
  argv: WorkspaceArgv,
  config: Pick<Config, 'workspace'>
): number | undefined {
  if (typeof argv.maxDepth === 'number' && argv.maxDepth > 0) {
    return argv.maxDepth
  }
  return config.workspace?.maxDepth
}

/**
 * Build the synthetic UI argv the workspace uses to drill into a repo.
 * Mirrors `createLogArgvFromUiArgv` but seeded from the workspace's own
 * argv shape so the user's --no-all / --branch-style flags carry through
 * if they happened to set them.
 */
export function buildDrillInUiArgv(argv: WorkspaceArgv): UiArgv {
  return ({
    _: ['ui'],
    $0: argv.$0,
    interactive: true,
    verbose: argv.verbose,
    version: false,
    help: false,
    theme: argv.theme,
    all: true,
    repo: undefined,
  } as unknown) as UiArgv
}

import type { WorkspaceExitResult } from '../../workstation/surfaces/workspace'

export type WorkspaceLoopDeps = {
  startWorkspace: (
    resume: WorkspaceResumeState | undefined
  ) => Promise<WorkspaceExitResult>
  runUiForRepo: (repoPath: string) => Promise<void>
  chdir: (target: string) => void
  baseCwd: string
}

/**
 * Pure loop: workspace ↔ ui drill-in. Each round-trip rewinds cwd
 * back to the original directory so the next workspace mount sees a
 * stable config-lookup root.
 *
 * Extracted from `startCocoWorkspace` so the loop is testable
 * without mounting real Ink instances or shelling out.
 */
export async function runWorkspaceLoop(deps: WorkspaceLoopDeps): Promise<void> {
  let resume: WorkspaceResumeState | undefined
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await deps.startWorkspace(resume)
    if (result.kind === 'quit') {
      return
    }
    resume = result.resume
    try {
      deps.chdir(result.repo.path)
      await deps.runUiForRepo(result.repo.path)
    } finally {
      deps.chdir(deps.baseCwd)
    }
  }
}

export async function startCocoWorkspace(argv: WorkspaceArgv): Promise<void> {
  // `--repo` still applies — useful if the user wants to scope a
  // single root override and have it interpreted relative to a target
  // directory. The workspace surface itself never operates on a single
  // SimpleGit; this just keeps config loading consistent with the
  // other commands.
  applyRepoFlag(argv)

  const config = loadConfig<Config, WorkspaceArgv>(argv)
  const roots = resolveWorkspaceRoots(argv, config)
  const knownRepos = resolveWorkspaceKnownRepos(config)
  const maxDepth = resolveWorkspaceMaxDepth(argv, config)
  const baseCwd = process.cwd()

  await runWorkspaceLoop({
    baseCwd,
    chdir: (target) => process.chdir(target),
    startWorkspace: (resume) =>
      startWorkspace({
        roots,
        knownRepos,
        maxDepth,
        appLabel: 'coco workspace',
        theme: argv.theme
          ? { ...config.logTui?.theme, preset: argv.theme }
          : config.logTui?.theme,
        resume,
      }),
    runUiForRepo: async (repoPath) => {
      const drillArgv = buildDrillInUiArgv(argv)
      const logArgv = createLogArgvFromUiArgv(drillArgv)
      const git = getRepo(repoPath)
      await startCocoUiFromLogArgv(logArgv, { git })
    },
  })
}

export const handler: CommandHandler<WorkspaceArgv> = async (argv) => {
  await startCocoWorkspace(argv)
}
