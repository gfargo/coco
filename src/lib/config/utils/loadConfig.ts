import { loadEnvConfig } from '../services/env'
import { loadGitConfig } from '../services/git'
import { loadGitignore, loadIgnore } from '../services/ignore'
import { loadProjectJsonConfig } from '../services/project'
import { loadXDGConfig } from '../services/xdg'
import { Config } from '../types'

import { DEFAULT_CONFIG, DEFAULT_IGNORED_FILES, DEFAULT_IGNORED_EXTENSIONS } from '../constants'
import { BaseCommandOptions } from '../../../commands/types'
import { mergeIgnoreLists, unionPreservingOrder } from './mergeIgnoreLists'
import { removeUndefined } from '../../utils/removeUndefined'

export type ConfigSource =
  | 'default'
  | 'gitignore'
  | 'ignore'
  | 'xdg'
  | 'git'
  | 'project'
  | 'env'
  | 'argv'

export interface ConfigSourceInfo {
  source: ConfigSource
  path?: string
}

/**
 * Tracked config sources populated during the last loadConfig call.
 * Useful for diagnostics (e.g. `coco doctor`).
 */
let _lastConfigSources: ConfigSourceInfo[] = []

/**
 * Returns the config sources detected during the most recent loadConfig call.
 */
export function getConfigSources(): ConfigSourceInfo[] {
  return _lastConfigSources
}

/**
 * Load application config
 *
 * Merge config from multiple sources.
 *
 * \* Order of precedence:
 * \* 1. Command line flags
 * \* 2. Environment variables
 * \* 3. Project config
 * \* 4. Git config
 * \* 5. XDG config
 * \* 6. .gitignore
 * \* 7. .ignore
 * \* 8. Default config
 *
 * @returns {Config} application config
 **/
export function loadConfig<ConfigType, ArgvType = BaseCommandOptions>(argv = {} as ArgvType) {
  const sources: ConfigSourceInfo[] = [{ source: 'default' }]

  // Default config (copy — never mutate the shared DEFAULT_CONFIG singleton)
  let config: Config = {
    ...DEFAULT_CONFIG,
    ignoredFiles: [...DEFAULT_IGNORED_FILES],
    ignoredExtensions: [...DEFAULT_IGNORED_EXTENSIONS],
  }

  config = loadGitignore(config)
  config = loadIgnore(config)

  const { config: xdgConfig, path: xdgPath } = loadXDGConfig(config, { returnSource: true })
  config = xdgConfig
  if (xdgPath) sources.push({ source: 'xdg', path: xdgPath })

  const { config: gitConfig, path: gitPath } = loadGitConfig(config, { returnSource: true })
  config = gitConfig
  if (gitPath) sources.push({ source: 'git', path: gitPath })

  const { config: projectConfig, path: projectPath } = loadProjectJsonConfig(config, { returnSource: true })
  config = projectConfig
  if (projectPath) sources.push({ source: 'project', path: projectPath })

  const { config: envConfig, active: envActive } = loadEnvConfig(config, { returnSource: true })
  config = envConfig
  if (envActive) sources.push({ source: 'env' })

  // Re-apply the canonical default ignore lists after every loader has
  // had a chance to override (#851). Each loader replaces ignoredFiles
  // / ignoredExtensions wholesale via shallow spread, which used to
  // silently drop the lockfile + node_modules defaults the moment a
  // user provided their own list. The merge is a union — defaults first,
  // user-only entries appended.
  config = mergeIgnoreLists(config)

  _lastConfigSources = sources

  // Strip yargs' positional/meta keys and any undefined values before
  // applying argv over config, so an omitted flag doesn't clobber a
  // config-sourced value (#1437) and `_`/`$0` don't leak into Config.
  const restArgv: Record<string, unknown> = { ...(argv as Record<string, unknown>) }
  delete restArgv._
  delete restArgv.$0
  const cleanedArgv = removeUndefined(restArgv)

  // argv wins for everything *except* the ignore lists: those are unioned
  // against the fully-resolved (defaults + gitignore + loader) list so a
  // narrowing `--ignoredFiles`/`--ignoredExtensions` extends rather than
  // replaces it — otherwise it silently re-admits lockfiles, node_modules,
  // and gitignore-derived secrets like `.env` into the diff (#1921).
  const merged = { ...config, ...cleanedArgv }
  merged.ignoredFiles = unionPreservingOrder(
    config.ignoredFiles ?? [],
    cleanedArgv.ignoredFiles as string[] | string | undefined
  )
  merged.ignoredExtensions = unionPreservingOrder(
    config.ignoredExtensions ?? [],
    cleanedArgv.ignoredExtensions as string[] | string | undefined
  )

  // Deep-merge `service` rather than letting the shallow top-level spread
  // replace it wholesale, matching services/env.ts (#1922).
  const argvService = (cleanedArgv as { service?: unknown }).service
  if (argvService && config.service) {
    merged.service = {
      ...(config.service as object),
      ...(argvService as object),
    } as Config['service']
  }

  return merged as Config & ConfigType & ArgvType
}
