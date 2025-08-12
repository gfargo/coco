import { lint, load } from '@commitlint/core'
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
 * Load commitlint configuration
 */
export async function loadCommitlintConfig(): Promise<QualifiedConfig> {
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

  // If nothing worked, fallback to conventional config
  return load({
    extends: ['@commitlint/config-conventional'],
  })
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
      ruleDescriptions.push(`Header (title) must be ${maxLength} characters or less`)
    }
  }
  
  if (rules['header-min-length']) {
    const [level, , minLength] = rules['header-min-length']
    if (level > 0) {
      ruleDescriptions.push(`Header (title) must be at least ${minLength} characters`)
    }
  }

  // Body length rules
  if (rules['body-max-line-length']) {
    const [level, , maxLength] = rules['body-max-line-length']
    if (level > 0) {
      ruleDescriptions.push(`Body lines must be ${maxLength} characters or less`)
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
