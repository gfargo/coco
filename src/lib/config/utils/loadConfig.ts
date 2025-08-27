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
export function loadConfig<ConfigType, ArgvType = BaseCommandOptions>(argv = {} as ArgvType) {
  // Default config
  let config = DEFAULT_CONFIG
  console.debug(`[DEBUG] loadConfig: Starting with default config`)

  config = loadGitignore(config)
  config = loadIgnore(config)
  config = loadXDGConfig(config)
  console.debug(`[DEBUG] loadConfig: After XDG config, hasService=${!!config.service}`)
  
  config = loadGitConfig(config)
  console.debug(`[DEBUG] loadConfig: After Git config, hasService=${!!config.service}, provider=${config.service?.provider}`)
  
  config = loadProjectJsonConfig(config)
  console.debug(`[DEBUG] loadConfig: After Project JSON config, hasService=${!!config.service}, provider=${config.service?.provider}`)
  if (config.service?.authentication?.type === 'APIKey') {
    const hasApiKey = !!(config.service.authentication.credentials?.apiKey)
    console.debug(`[DEBUG] loadConfig: After Project config, hasApiKey=${hasApiKey}`)
  }
  
  config = loadEnvConfig(config)
  console.debug(`[DEBUG] loadConfig: After Env config, hasService=${!!config.service}, provider=${config.service?.provider}`)
  if (config.service?.authentication?.type === 'APIKey') {
    const hasApiKey = !!(config.service.authentication.credentials?.apiKey)
    console.debug(`[DEBUG] loadConfig: Final config, hasApiKey=${hasApiKey}`)
  }

  const finalConfig = { ...config, ...argv } as Config & ConfigType & ArgvType
  console.debug(`[DEBUG] loadConfig: Final merged config, hasService=${!!finalConfig.service}`)
  
  return finalConfig
}
