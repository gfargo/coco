import { CommandHandler } from '../../lib/types'
import { Config } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { startWorkspace } from '../../workstation/surfaces/workspace'
import { applyRepoFlag } from '../utils/applyRepoFlag'

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

  await startWorkspace({
    roots,
    knownRepos,
    maxDepth,
    appLabel: 'coco workspace',
    theme: argv.theme ? { ...config.logTui?.theme, preset: argv.theme } : config.logTui?.theme,
  })
}

export const handler: CommandHandler<WorkspaceArgv> = async (argv) => {
  await startCocoWorkspace(argv)
}
