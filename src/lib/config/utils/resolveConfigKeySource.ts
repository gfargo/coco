import { loadEnvConfig } from '../services/env'
import { loadGitConfig } from '../services/git'
import { loadProjectJsonConfig } from '../services/project'
import { loadXDGConfig } from '../services/xdg'
import { getDottedPath } from './dottedPath'
import type { ConfigSource } from './loadConfig'

export type ConfigKeySourceInfo = {
  source: ConfigSource
  path?: string
}

/**
 * Determine which config layer actually supplies a given dotted key's
 * effective value (#1605 `coco config get`'s "which source won" display).
 *
 * `loadConfig` tracks which sources were *active* overall
 * (`getConfigSources`), but not which one wins for any one key — this
 * re-runs each `returnSource`-capable loader against an empty base so its
 * return value reflects only what that layer itself defines, then checks
 * highest-precedence-first (mirrors `loadConfig`'s merge order: env >
 * project > git > xdg > default; argv isn't considered here since `coco
 * config get` reads persisted config, not a live invocation's flags).
 */
export function resolveConfigKeySource(key: string): ConfigKeySourceInfo {
  const { config: envConfig, active: envActive } = loadEnvConfig({}, { returnSource: true })
  if (envActive && getDottedPath(envConfig, key) !== undefined) {
    return { source: 'env' }
  }

  const { config: projectConfig, path: projectPath } = loadProjectJsonConfig({}, { returnSource: true })
  if (projectPath && getDottedPath(projectConfig, key) !== undefined) {
    return { source: 'project', path: projectPath }
  }

  const { config: gitConfig, path: gitPath } = loadGitConfig({}, { returnSource: true })
  if (gitPath && getDottedPath(gitConfig, key) !== undefined) {
    return { source: 'git', path: gitPath }
  }

  const { config: xdgConfig, path: xdgPath } = loadXDGConfig({}, { returnSource: true })
  if (xdgPath && getDottedPath(xdgConfig, key) !== undefined) {
    return { source: 'xdg', path: xdgPath }
  }

  return { source: 'default' }
}
