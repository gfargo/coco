import { loadEnvConfig } from '../services/env'
import { loadGitConfig } from '../services/git'
import { loadGitignore, loadIgnore } from '../services/ignore'
import { loadProjectJsonConfig } from '../services/project'
import { loadXDGConfig } from '../services/xdg'
import { Config } from '../types'

import { DEFAULT_CONFIG } from '../constants'
import { BaseCommandOptions } from '../../../commands/types'

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
export function loadConfig<ConfigType, ArgvType = BaseCommandOptions>(
  argv = {} as ArgvType
) {
  // Default config
  let config = DEFAULT_CONFIG

  config = loadGitignore(config)
  config = loadIgnore(config)
  config = loadXDGConfig(config)
  config = loadGitConfig(config)
  config = loadProjectJsonConfig(config)
  config = loadEnvConfig(config)

  return { ...config, ...argv } as Config & ConfigType & ArgvType
}
