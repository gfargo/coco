import * as fs from 'fs'
import * as path from 'path'
import { Config } from '../types'

/**
 * Load .gitignore in project root
 *
 * @param {Config} config
 * @param {string} [cwd] Directory to resolve `.gitignore` against. Defaults
 *   to `process.cwd()`.
 * @returns
 */
export function loadGitignore<ConfigType = Config>(config: Partial<Config>, cwd: string = process.cwd()) {
  const gitignorePath = path.join(cwd, '.gitignore')
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8')

    return {
      ...config,
      ignoredFiles: [
        ...(config?.ignoredFiles || []),
        ...gitignoreContent
          .split('\n')
          .filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('!')),
      ],
    } as ConfigType
  }
  return config as ConfigType
}

/**
 * Load .ignore in project root
 *
 * @param {Config} config
 * @param {string} [cwd] Directory to resolve `.ignore` against. Defaults to
 *   `process.cwd()`.
 * @returns
 */
export function loadIgnore<ConfigType = Config>(config: Partial<Config>, cwd: string = process.cwd()) {
  const ignorePath = path.join(cwd, '.ignore')
  if (fs.existsSync(ignorePath)) {
    const ignoreContent = fs.readFileSync(ignorePath, 'utf-8')
    return {
      ...config,
      ignoredFiles: [
        ...(config?.ignoredFiles || []),
        ...ignoreContent
          .split('\n')
          .filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('!')),
      ],
    } as ConfigType
  }
  return config as ConfigType
}
