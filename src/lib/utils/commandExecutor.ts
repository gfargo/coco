import chalk from 'chalk'
import { Argv } from 'yargs'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'
import { BaseArgvOptions } from '../../commands/types'
import { Config } from '../config/types'
import { LangChainNetworkError, LangChainAuthenticationError } from '../langchain/errors'
import { isCommandExitError } from './commandExit'
import { decideUsageConsent, isConsentInteractive, USAGE_ENABLED_NOTICE } from './usageConsent'
import { persistUsagePreference } from '../config/services/xdg'
import {
  isUsageLoggingEnabled,
  setUsageConfigPreference,
  setUsageRepoTag,
} from '../langchain/utils/usageLedger'
import { resolveRepoIdentifier } from '../../git/repoIdentifier'
import { setForgeHostOverrides } from '../../git/providerData'

/**
 * Formats a network error with helpful troubleshooting information
 */
function formatNetworkError(error: LangChainNetworkError, logger: Logger): void {
  const endpoint = error.endpoint || 'unknown endpoint'
  const provider = error.provider || 'LLM service'

  logger.error('\nFailed to execute command', { color: 'yellow' })
  logger.error(`\nError: Unable to connect to ${provider}`, { color: 'red' })

  if (error.endpoint) {
    logger.error(`       Endpoint: ${endpoint}`, { color: 'red' })
  }

  logger.error('\nTroubleshooting:', { color: 'cyan' })

  // Provider-specific troubleshooting
  if (provider === 'ollama' || endpoint.includes('11434')) {
    logger.error('  • Is Ollama running? Try: ollama serve', { color: 'white' })
    logger.error('  • Check if the endpoint is correct in your config', { color: 'white' })
    logger.error(`  • Verify Ollama is accessible: curl ${endpoint}/api/version`, { color: 'white' })
  } else if (provider === 'openai' || endpoint.includes('openai')) {
    logger.error('  • Check your internet connection', { color: 'white' })
    logger.error('  • Verify the API endpoint is accessible', { color: 'white' })
    logger.error('  • If using a custom baseURL, verify it is correct', { color: 'white' })
  } else if (provider === 'anthropic') {
    logger.error('  • Check your internet connection', { color: 'white' })
    logger.error('  • Verify the Anthropic API is accessible', { color: 'white' })
  } else {
    logger.error('  • Check your internet connection', { color: 'white' })
    logger.error('  • Verify the service endpoint is correct', { color: 'white' })
    logger.error('  • Ensure the LLM service is running and accessible', { color: 'white' })
  }

  logger.error('  • Run `coco doctor` to verify your configured provider + endpoint', { color: 'white' })

  logger.verbose(`\nOriginal error: ${error.message}`, { color: 'gray' })
}

/**
 * Formats an authentication error with provider-aware troubleshooting.
 *
 * Pre-MEDIUM-8 the formatter was generic — "verify your API key,
 * check it hasn't expired" — because the error class didn't carry
 * any provider context. Now that `LangChainAuthenticationError`
 * carries `provider` + `endpoint` (mirroring `LangChainNetworkError`),
 * we can name the env var the user actually needs to set and route
 * Ollama / OpenAI-compatible / managed-provider users through the
 * right next step.
 */
function formatAuthenticationError(error: LangChainAuthenticationError, logger: Logger): void {
  const provider = error.provider || 'LLM service'
  const endpoint = error.endpoint

  logger.error('\nFailed to execute command', { color: 'yellow' })
  logger.error(`\nError: Authentication failed${error.provider ? ` for ${provider}` : ''}`, { color: 'red' })

  if (endpoint) {
    logger.error(`       Endpoint: ${endpoint}`, { color: 'red' })
  }

  logger.error('\nTroubleshooting:', { color: 'cyan' })
  logger.error('  • Verify your API key is correct and has not expired', { color: 'white' })

  // Provider-specific env var hint when we know the provider.
  if (provider === 'openai' || provider === 'OpenAI') {
    logger.error('  • Set `OPENAI_API_KEY` in your shell or `service.authentication.credentials.apiKey` in config', { color: 'white' })
  } else if (provider === 'anthropic' || provider === 'Anthropic') {
    logger.error('  • Set `ANTHROPIC_API_KEY` in your shell or `service.authentication.credentials.apiKey` in config', { color: 'white' })
  } else if (provider === 'ollama' || provider === 'Ollama') {
    logger.error('  • Ollama usually does not need a key — check `service.endpoint` and that `ollama serve` is running', { color: 'white' })
  } else if (provider === 'openai-compatible') {
    logger.error('  • OpenAI-compatible endpoints need both `service.endpoint` and a valid API key', { color: 'white' })
  } else {
    logger.error('  • Ensure the API key is set in your environment or config', { color: 'white' })
  }

  logger.error('  • Run `coco init` to (re)configure your provider + key', { color: 'white' })
  logger.error('  • Run `coco doctor` to inspect the active config sources', { color: 'white' })

  logger.verbose(`\nOriginal error: ${error.message}`, { color: 'gray' })
}

/**
 * Formats a generic error.
 *
 * The error message prints unconditionally (was previously gated behind
 * `--verbose`, which left users staring at a "Failed to execute command"
 * line with no actionable detail when something crashed). The full stack
 * trace stays under `logger.verbose` so plain output stays focused on the
 * one-line cause; users running into something they can't diagnose can opt
 * in with `--verbose` for the trace.
 */
function formatGenericError(error: Error, logger: Logger): void {
  logger.error('\nFailed to execute command', { color: 'yellow' })
  logger.error(`\nError: ${error.message}`, { color: 'red' })
  if (error.stack) {
    logger.verbose(`\n${error.stack}`, { color: 'gray' })
  }
}

/**
 * Detect a user-cancelled interactive prompt. `@inquirer/prompts` throws an
 * `ExitPromptError` (message: "User force closed the prompt …") when the user
 * hits Ctrl-C — or when there's no TTY and stdin is closed (e.g. a piped run).
 * Without this it fell through to {@link formatGenericError} and surfaced as a
 * scary "Failed to execute command / Error: User force closed the prompt with
 * 0 null" — a rough first-run moment for anyone who Ctrl-C's out of `coco init`.
 * Matched by name (not an `instanceof` import) to stay decoupled from the
 * prompt lib's version, with a message fallback for older variants.
 */
export function isPromptCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'ExitPromptError' || /force closed the prompt/i.test(error.message)
}

/**
 * Detect Ollama's "model not pulled" failure and pull out the model name.
 *
 * When the daemon is up but the requested model isn't pulled, Ollama returns
 * `model "<name>" not found, try pulling it first`. We gate on both `not found`
 * **and** `pull` so an OpenAI/Anthropic "model does not exist" error doesn't get
 * mis-advised toward `ollama pull`. Returns the model name, or null when the
 * error isn't this case.
 */
export function extractMissingOllamaModel(error: unknown): string | null {
  const message = error instanceof Error ? error.message : ''
  if (!message) return null
  if (!/not found/i.test(message) || !/pull/i.test(message)) return null
  const match = message.match(/model\s+["']?([^"'\s]+)["']?\s+not found/i)
  return match ? match[1] : null
}

/**
 * Render an actionable hint for a not-yet-pulled Ollama model, instead of
 * letting the raw "model not found" bubble through the generic formatter.
 */
function formatModelNotFoundError(model: string, logger: Logger): void {
  logger.error(`\nError: Ollama model "${model}" isn't available locally`, { color: 'red' })
  logger.error('\nLikely fixes:', { color: 'yellow' })
  logger.error(`  • Pull it: ollama pull ${model}`, { color: 'white' })
  logger.error('  • See what you have: ollama list', { color: 'white' })
  logger.error('  • Run `coco doctor` to check your provider + model', { color: 'white' })
}

/**
 * Resolve the local usage-stats recording preference for this run (#0.69) and
 * arm the ledger. Recording is opt-out: a first interactive run with no
 * preference set anywhere defaults on, persists the choice to the global
 * config, and prints a one-time notice; non-interactive / CI runs stay off.
 * `COCO_USAGE_LOG` overrides everything. When recording is on, the current
 * repo identifier is resolved so usage can be broken down per project. Entirely
 * best-effort — telemetry setup must never break a command.
 */
async function applyUsageTelemetry(argv: unknown, options: Config, logger: Logger): Promise<void> {
  try {
    const commandName = String((argv as { _?: unknown[] })?._?.[0] ?? '')
    const decision = decideUsageConsent({
      commandName,
      configPreference: options.telemetry?.usage,
      envOverride: process.env.COCO_USAGE_LOG,
      interactive: isConsentInteractive(),
    })
    setUsageConfigPreference(decision.preference)

    if (decision.enabledOnFirstRun) {
      persistUsagePreference(true)
      logger.log(chalk.dim(USAGE_ENABLED_NOTICE))
    }

    if (isUsageLoggingEnabled()) {
      const repoDir = (argv as { repo?: string })?.repo
      setUsageRepoTag(await resolveRepoIdentifier({ cwd: repoDir }))
    }
  } catch {
    // Telemetry setup is never allowed to interfere with the command.
  }
}

function commandExecutor<T extends Argv<BaseArgvOptions>['argv']>(handler: CommandHandler<T>) {
  return async (argv: T) => {
    const options = loadConfig(argv)
    // `--quiet` flips the logger quiet so coco's status chrome is suppressed.
    // Results still reach stdout (handleResult / emitJson write directly).
    // Note: `quiet` (not `silent`) is used intentionally — quiet suppresses
    // status output only; error() calls always reach stderr regardless.
    const quiet = (argv as { quiet?: boolean })?.quiet === true
    const logger = new Logger(quiet ? { ...options, quiet: true } : options)

    // Arm self-hosted forge detection (vanity hostnames) for this run.
    setForgeHostOverrides((options as Config).forgeHosts)

    await applyUsageTelemetry(argv, options as Config, logger)

    try {
      await handler(argv, logger)
    } catch (error) {
      if (isCommandExitError(error)) {
        process.exitCode = error.code
        return
      }

      // A user-cancelled prompt (Ctrl-C out of `coco init`, or a non-TTY
      // run) is a normal action, not a crash — exit cleanly with a gentle
      // note instead of the generic "Failed to execute command" path.
      if (isPromptCancellation(error)) {
        logger.log('\nCancelled.', { color: 'yellow' })
        process.exitCode = 130 // 128 + SIGINT, the conventional "interrupted" code
        return
      }

      // Stop any running spinner before writing error output so its control
      // characters don't interleave with the error lines on stderr.
      logger.stopSpinnerIfActive()

      // Handle specific error types with helpful messages
      const missingOllamaModel = extractMissingOllamaModel(error)
      if (error instanceof LangChainNetworkError) {
        formatNetworkError(error, logger)
      } else if (error instanceof LangChainAuthenticationError) {
        formatAuthenticationError(error, logger)
      } else if (missingOllamaModel) {
        formatModelNotFoundError(missingOllamaModel, logger)
      } else {
        formatGenericError(error as Error, logger)
      }

      logger.error('\nThanks for using coco, make it a great day! 👋🤖', { color: 'blue' })
      process.exitCode = 1
    }
  }
}

export default commandExecutor
