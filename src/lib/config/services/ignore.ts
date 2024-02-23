import * as fs from 'fs'
import { Config } from '../types'

/**
 * Load .gitignore in project root
 *
 * @param {Config} config
 * @returns
 */
export function loadGitignore<ConfigType = Config>(config: Partial<Config>) {
  if (fs.existsSync('.gitignore')) {
    const gitignoreContent = fs.readFileSync('.gitignore', 'utf-8')
    
    config.ignoredFiles = [
      ...(config?.ignoredFiles || []),
      ...gitignoreContent.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')),
    ]
  }
  return config as ConfigType
}

/**
 * Load .ignore in project root
 *
 * @param {Config} config
 * @returns
 */
export function loadIgnore<ConfigType = Config>(config: Partial<Config>) {
  if (fs.existsSync('.ignore')) {
    const ignoreContent = fs.readFileSync('.ignore', 'utf-8')
    config.ignoredFiles = [
      ...(config?.ignoredFiles || []),
      ...ignoreContent.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')),
    ]
  }
  return config as ConfigType
}
