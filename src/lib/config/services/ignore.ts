import * as fs from 'fs'
import { Config } from '../types'

/**
 * Load .gitignore in project root
 *
 * @param {Config} config
 * @returns
 */
export function loadGitignore(config: Config): Config {
  if (fs.existsSync('.gitignore')) {
    const gitignoreContent = fs.readFileSync('.gitignore', 'utf-8')
    config.ignoredFiles = [
      ...(config?.ignoredFiles || []),
      ...gitignoreContent.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')),
    ]
  }
  return config
}

/**
 * Load .ignore in project root
 *
 * @param {Config} config
 * @returns
 */
export function loadIgnore(config: Config): Config {
  if (fs.existsSync('.ignore')) {
    const ignoreContent = fs.readFileSync('.ignore', 'utf-8')
    config.ignoredFiles = [
      ...(config?.ignoredFiles || []),
      ...ignoreContent.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')),
    ]
  }
  return config
}
