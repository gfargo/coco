import * as fs from 'fs'
import { Config } from '../types'

/**
 * Load project config
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadProjectConfig(config: Config): Config {
  // TODO: Add validation based of JSON schema?
  if (fs.existsSync('.coco.config.json')) {
    const projectConfig = JSON.parse(fs.readFileSync('.coco.config.json', 'utf-8')) as Config
    config = { ...config, ...projectConfig }
  }
  return config
}
