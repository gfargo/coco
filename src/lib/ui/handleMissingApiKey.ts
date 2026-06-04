import chalk from 'chalk'

import { Config } from '../config/types'
import { commandExit } from '../utils/commandExit'
import { Logger } from '../utils/logger'
import { FAIL, GLYPHS } from './glyphs'

/**
 * Maps each provider to the env var users should set + the kebab-case
 * provider label used in the recovery copy. `coco init` and `coco
 * doctor` both reference these names; keeping the lookup in one place
 * makes the messages stay aligned when a new provider lands.
 */
const PROVIDER_ENV_VARS: Record<string, { envVar: string; label: string }> = {
  openai: { envVar: 'OPENAI_API_KEY', label: 'OpenAI' },
  anthropic: { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
  ollama: { envVar: 'OLLAMA_API_KEY', label: 'Ollama' },
  'openai-compatible': { envVar: 'OPENAI_API_KEY', label: 'OpenAI-compatible' },
}

/**
 * Print a structured "missing API key" message + exit non-zero.
 *
 * Replaces the old `No API Key found. 🗝️🚪` one-liner that used to live
 * inline in commit / changelog / recap / review handlers. Centralised
 * because:
 *
 *   1. The message names the env var the user actually needs to set
 *      (different per provider) — that was the single biggest gap in
 *      the prior message.
 *   2. It surfaces the configured provider + model so the user can tell
 *      which of their providers tripped the check (useful when running
 *      with dynamic model routing).
 *   3. It points at `coco init` and `coco doctor` as the recovery
 *      paths, mirroring the discoverability cue every other modern CLI
 *      uses for first-run config errors.
 *
 * Throws `CommandExitError(1)` via `commandExit` — callers do NOT need
 * to handle the return value.
 */
export function handleMissingApiKey(
  logger: Logger,
  config: Config,
  options: { command: string }
): never {
  const provider = config.service?.provider || 'unknown'
  const model = config.service?.model || 'unknown'
  const providerInfo = PROVIDER_ENV_VARS[provider] || {
    envVar: 'PROVIDER_API_KEY',
    label: provider,
  }

  const lines = [
    `${FAIL()} ${chalk.bold('Missing API key')} for ${chalk.cyan(providerInfo.label)} (model: ${chalk.cyan(model)})`,
    '',
    `${chalk.bold('Next step')} — set up an API key one of these ways:`,
    `  ${chalk.dim(GLYPHS.bullet)} Run ${chalk.cyan('coco init')} to walk through provider + key setup`,
    `  ${chalk.dim(GLYPHS.bullet)} Export ${chalk.cyan(providerInfo.envVar)} in your shell`,
    `  ${chalk.dim(GLYPHS.bullet)} Add the key to ${chalk.cyan('.coco.config.json')} or ${chalk.cyan('~/.gitconfig')} (under ${chalk.cyan('[coco]')})`,
    '',
    `${chalk.dim('Run')} ${chalk.cyan('coco doctor')} ${chalk.dim('to diagnose the active config sources.')}`,
  ]

  for (const line of lines) {
    logger.log(line)
  }

  // Tag the exit message with the failing command so process supervisors
  // / CI logs can grep for it without parsing the full body.
  commandExit(1, `${options.command}: missing API key for ${providerInfo.label}`)
}
