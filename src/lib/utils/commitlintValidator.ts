import { lint, load } from '@commitlint/core'
import type { LintOptions, QualifiedConfig } from '@commitlint/types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { findProjectRoot } from './findProjectRoot'

/**
 * Result of commit message validation
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Check if a commitlint configuration exists in the project root
 */
export async function hasCommitlintConfig(): Promise<boolean> {
  const projectRoot = await findProjectRoot(process.cwd())
  if (!projectRoot) return false

  const possibleConfigFiles = [
    '.commitlintrc',
    '.commitlintrc.json',
    '.commitlintrc.yaml',
    '.commitlintrc.yml',
    '.commitlintrc.js',
    'commitlint.config.js',
    'commitlint.config.cjs',
    '.commitlintrc.cjs',
    'package.json',
  ]

  // Check for dedicated commitlint config files
  for (const file of possibleConfigFiles) {
    if (existsSync(join(projectRoot, file))) {
      // For package.json, check if it contains commitlint config
      if (file === 'package.json') {
        const pkgContent = readFileSync(join(projectRoot, file), 'utf8')
        const pkg = JSON.parse(pkgContent)
        if (pkg.commitlint) return true
      } else {
        return true
      }
    }
  }

  return false
}

/**
 * Load commitlint configuration
 */
export async function loadCommitlintConfig(): Promise<QualifiedConfig> {
  try {
    // Try to load project config
    const config = await load()
    return config
  } catch (error) {
    // If no config found or error loading, use conventional config
    return load({
      extends: ['@commitlint/config-conventional'],
    })
  }
}

/**
 * Validate a commit message using commitlint
 */
export async function validateCommitMessage(
  message: string,
  options: LintOptions = {}
): Promise<ValidationResult> {
  try {
    const config = await loadCommitlintConfig()
    const result = await lint(message, config.rules, options)

    return {
      valid: result.valid,
      errors: result.errors.map((error) => error.message),
      warnings: result.warnings.map((warning) => warning.message),
    }
  } catch (error) {
    return {
      valid: false,
      errors: [(error as Error).message],
      warnings: [],
    }
  }
}
