import type { LintOptions, QualifiedConfig } from '@commitlint/types'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { COMMITLINT_CONFIG_FILES } from '../config/commitlint'
import { findProjectRoot } from './findProjectRoot'

/**
 * Result of commit message validation
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  missingDependencies?: string[]
}

/**
 * Custom error for commitlint validation failures
 * This allows the retry system to identify these errors specifically
 */
export class CommitlintValidationError extends Error {
  public readonly validationResult: ValidationResult
  public readonly commitMessage: string

  constructor(message: string, validationResult: ValidationResult, commitMessage: string) {
    super(message)
    this.name = 'CommitlintValidationError'
    this.validationResult = validationResult
    this.commitMessage = commitMessage
  }
}

/**
 * Check if commitlint config packages are available
 * We only check for config-conventional since @commitlint/core is bundled with git-coco
 */
export function checkCommitlintAvailability(): { available: boolean; missingPackages: string[] } {
  const requiredPackages = ['@commitlint/config-conventional']
  const missingPackages: string[] = []

  for (const pkg of requiredPackages) {
    try {
      // Try to resolve the package from the current working directory
      require.resolve(pkg, { paths: [process.cwd(), ...module.paths] })
      
      // Additional check: try to actually load the config to catch ES module issues
      try {
        require(pkg)
      } catch (loadError) {
        const loadErrorMessage = loadError instanceof Error ? loadError.message : String(loadError)
        // If we can resolve but can't load due to ES module issues, treat as missing
        if (loadErrorMessage.includes('Directory import') || 
            loadErrorMessage.includes('is not supported resolving ES modules')) {
          missingPackages.push(pkg)
        }
      }
    } catch (error) {
      missingPackages.push(pkg)
    }
  }

  // If config-conventional is missing, also suggest installing CLI
  if (missingPackages.length > 0) {
    missingPackages.push('@commitlint/cli')
  }

  return {
    available: missingPackages.length === 0,
    missingPackages,
  }
}

/**
 * Check if we're in a pnpm environment with ES module issues
 */
function isPnpmEsModuleIssue(error: Error): boolean {
  const message = error.message
  return (
    message.includes('Directory import') &&
    message.includes('is not supported resolving ES modules') &&
    message.includes('@commitlint/config-conventional')
  )
}

/**
 * Load commitlint configuration
 */
export async function loadCommitlintConfig(): Promise<QualifiedConfig> {
  const { load } = await import('@commitlint/core')
  const projectRoot = findProjectRoot(process.cwd())
  const cwd = projectRoot || process.cwd()

  // @commitlint/load has issues with ESM configs (e.g. commitlint.config.js with `export default`).
  // Let's try to load them manually first.
  const esmConfigCandidates = COMMITLINT_CONFIG_FILES.filter((file) => file.endsWith('.js'))

  for (const configFile of esmConfigCandidates) {
    const configPath = join(cwd, configFile)
    if (existsSync(configPath)) {
      try {
        const module = await import(pathToFileURL(configPath).href)
        if (
          module.default &&
          (Object.keys(module.default.rules || {}).length > 0 ||
            (module.default.extends && module.default.extends.length > 0))
        ) {
          // We found a config, now let commitlint process it (for extends etc)
          return await load(module.default, { cwd })
        }
      } catch (error) {
        // Failed to import, maybe not an ESM file after all or syntax error.
        // We will let the standard load take a chance.
      }
    }
  }

  try {
    // Let @commitlint/load try to find the config. This works for CJS, JSON, and YAML.
    const config = await load({}, { cwd })
    // Check if a real config was loaded.
    if (config.extends.length > 0 || Object.keys(config.rules).length > 0) {
      return config
    }
  } catch (error) {
    // Could be an error parsing, or just not found. Fall through to default.
  }

  // Try to fallback to conventional config, but handle missing dependencies gracefully
  try {
    return await load({
      extends: ['@commitlint/config-conventional'],
    })
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    
    // Handle various types of config-conventional loading errors
    const isConfigConventionalError = 
      error.message.includes('Cannot find module "@commitlint/config-conventional"') ||
      isPnpmEsModuleIssue(error)
    
    if (isConfigConventionalError) {
      // Return a basic conventional config that matches @commitlint/config-conventional rules
      return await load({
        rules: {
          'header-max-length': [2, 'always', 72],
          'header-min-length': [2, 'always', 8],
          'subject-empty': [2, 'never'],
          'subject-full-stop': [2, 'never', '.'],
          'subject-case': [2, 'always', ['sentence-case', 'start-case', 'pascal-case', 'upper-case', 'lower-case']],
          'type-empty': [2, 'never'],
          'type-case': [2, 'always', 'lower-case'],
          'type-enum': [2, 'always', [
            'build', 'chore', 'ci', 'docs', 'feat', 'fix', 
            'perf', 'refactor', 'revert', 'style', 'test'
          ]],
          'body-max-line-length': [2, 'always', 100],
          'scope-case': [2, 'always', 'lower-case'],
        },
      })
    }
    throw error
  }
}

/**
 * Format commitlint rules into a human-readable string for AI prompts
 */
export function formatCommitlintRulesForPrompt(config: QualifiedConfig): string {
  if (!config.rules || Object.keys(config.rules).length === 0) {
    return ''
  }

  const ruleDescriptions: string[] = []

  // Add information about extends if present
  if (config.extends && config.extends.length > 0) {
    ruleDescriptions.push(`Following ${config.extends.join(', ')} configuration`)
  }

  // Process key rules that affect commit message format
  const rules = config.rules
  
  // Header length rules
  if (rules['header-max-length']) {
    const [level, , maxLength] = rules['header-max-length']
    if (level > 0) {
      ruleDescriptions.push(`Header (title) must be ${maxLength} characters or less (including spaces)`)
    }
  }
  
  if (rules['header-min-length']) {
    const [level, , minLength] = rules['header-min-length']
    if (level > 0) {
      ruleDescriptions.push(`Header (title) must be at least ${minLength} characters (including spaces)`)
    }
  }

  // Body length rules
  if (rules['body-max-line-length']) {
    const [level, , maxLength] = rules['body-max-line-length']
    if (level > 0) {
      ruleDescriptions.push(`Body lines must be ${maxLength} characters or less (including spaces)`)
    }
  }

  // Type rules
  if (rules['type-enum']) {
    const [level, , allowedTypes] = rules['type-enum']
    if (level > 0 && Array.isArray(allowedTypes)) {
      ruleDescriptions.push(`Allowed types: ${allowedTypes.join(', ')}`)
    }
  }

  // Case rules
  if (rules['type-case']) {
    const [level, , caseType] = rules['type-case']
    if (level > 0) {
      ruleDescriptions.push(`Type must be ${caseType} case`)
    }
  }

  if (rules['subject-case']) {
    const [level, , caseType] = rules['subject-case']
    if (level > 0) {
      ruleDescriptions.push(`Subject must be ${caseType} case`)
    }
  }

  // Scope rules
  if (rules['scope-enum']) {
    const [level, , allowedScopes] = rules['scope-enum']
    if (level > 0 && Array.isArray(allowedScopes)) {
      ruleDescriptions.push(`Allowed scopes: ${allowedScopes.join(', ')}`)
    }
  }

  // Subject rules
  if (rules['subject-full-stop']) {
    const [level, condition] = rules['subject-full-stop']
    if (level > 0) {
      const verb = condition === 'always' ? 'must' : 'must not'
      ruleDescriptions.push(`Subject ${verb} end with a period`)
    }
  }

  if (rules['subject-empty']) {
    const [level, condition] = rules['subject-empty']
    if (level > 0) {
      const requirement = condition === 'never' ? 'must not be empty' : 'must be empty'
      ruleDescriptions.push(`Subject ${requirement}`)
    }
  }

  return ruleDescriptions.length > 0 
    ? `## Commitlint Rules\nYour commit message must follow these project-specific rules:\n${ruleDescriptions.map(rule => `- ${rule}`).join('\n')}\n`
    : ''
}

/**
 * Get commitlint rules context for prompt if config exists
 */
export async function getCommitlintRulesContext(): Promise<string> {
  try {
    const config = await loadCommitlintConfig()
    return formatCommitlintRulesForPrompt(config)
  } catch (error) {
    return ''
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
    const { lint } = await import('@commitlint/core')
    const config = await loadCommitlintConfig()
    const result = await lint(message, config.rules, options)

    return {
      valid: result.valid,
      errors: result.errors.map((error) => error.message),
      warnings: result.warnings.map((warning) => warning.message),
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      return {
        valid: false,
        errors: [String(error)],
        warnings: [],
      }
    }
    
    // Check if this is a config-conventional related error (including pnpm ES module issues)
    const isConfigConventionalError = 
      error.message.includes('Cannot find module "@commitlint/config-conventional"') ||
      isPnpmEsModuleIssue(error)
    
    if (isConfigConventionalError) {
      // For pnpm ES module issues, we should have already fallen back to built-in rules
      // during config loading, so this shouldn't happen. But if it does, provide helpful info.
      if (isPnpmEsModuleIssue(error)) {
        return {
          valid: false,
          errors: ['pnpm ES module compatibility issue with @commitlint/config-conventional'],
          warnings: ['Try: pnpm add -D @commitlint/config-conventional@latest @commitlint/cli@latest'],
        }
      }
      
      return {
        valid: false,
        errors: ['Commitlint configuration requires @commitlint/config-conventional to be installed'],
        warnings: [],
        missingDependencies: ['@commitlint/config-conventional', '@commitlint/cli'],
      }
    }

    return {
      valid: false,
      errors: [error.message],
      warnings: [],
    }
  }
}
