
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

/**
 * Matches a commitlint config that asks for the conventional `type(scope):`
 * shape: one of the conventional presets, or an explicit type rule.
 */
const CONVENTIONAL_COMMITLINT_PATTERN =
  /@commitlint\/config-(?:conventional|angular|lerna-scopes)|conventional-changelog-conventionalcommits|['"]?\btype-(?:empty|enum|case)\b/

/**
 * Whether the project's commitlint config requires conventional-commit
 * messages. Static text check only (the config file or `package.json`
 * `commitlint` key is read, never imported), so it is safe to call without
 * executing repository code. Used to default `coco commit` to conventional
 * format when commitlint would otherwise reject a plain message (#2130).
 */
export async function commitlintImpliesConventional(): Promise<boolean> {
  const projectRoot = findProjectRoot(process.cwd())
  if (!projectRoot) {
    return false
  }

  const sources: string[] = []
  for (const file of COMMITLINT_CONFIG_FILES) {
    const path = join(projectRoot, file)
    if (existsSync(path)) {
      try {
        sources.push(readFileSync(path, 'utf8'))
      } catch {
        // Unreadable config: treat as not conventional.
      }
    }
  }

  const pkgPath = join(projectRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.commitlint) {
        sources.push(JSON.stringify(pkg.commitlint))
      }
    } catch {
      // Ignore errors reading or parsing package.json
    }
  }

  return sources.some((source) => CONVENTIONAL_COMMITLINT_PATTERN.test(source))
}
