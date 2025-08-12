
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { COMMITLINT_CONFIG_FILES } from '../config/commitlint'
import { findProjectRoot } from './findProjectRoot'

/**
 * Check if a commitlint configuration exists in the project root.
 */
export async function hasCommitlintConfig(): Promise<boolean> {
  const projectRoot = findProjectRoot(process.cwd())
  if (!projectRoot) {
    return false
  }

  // Check for dedicated commitlint config files
  for (const file of COMMITLINT_CONFIG_FILES) {
    if (existsSync(join(projectRoot, file))) {
      return true
    }
  }

  // Check for commitlint config in package.json
  const pkgPath = join(projectRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkgContent = readFileSync(pkgPath, 'utf8')
      const pkg = JSON.parse(pkgContent)
      if (pkg.commitlint) {
        return true
      }
    } catch (error) {
      // Ignore errors reading or parsing package.json
    }
  }

  return false
}
