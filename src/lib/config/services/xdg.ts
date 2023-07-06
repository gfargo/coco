import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Config } from '../types'

/**
 * Load XDG config
 *
 * @param {Config} config
 * @returns {Config} Updated config
 */
export function loadXDGConfig(config: Config): Config {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const xdgConfigPath = path.join(xdgConfigHome, 'coco', 'config.json')
  if (fs.existsSync(xdgConfigPath)) {
    const xdgConfig = JSON.parse(fs.readFileSync(xdgConfigPath, 'utf-8')) as Config
    config = { ...config, ...xdgConfig }
  }
  return config
}
