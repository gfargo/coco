import { Argv } from 'yargs'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'
import { BaseArgvOptions } from '../../commands/types'
import { LangChainNetworkError, LangChainAuthenticationError } from '../langchain/errors'
import { isCommandExitError } from './commandExit'

/**
 * Formats a network error with helpful troubleshooting information
 */
function formatNetworkError(error: LangChainNetworkError, logger: Logger): void {
  const endpoint = error.endpoint || 'unknown endpoint'
  const provider = error.provider || 'LLM service'

  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.log(`\nError: Unable to connect to ${provider}`, { color: 'red' })

  if (error.endpoint) {
    logger.log(`       Endpoint: ${endpoint}`, { color: 'red' })
  }

  logger.log('\nTroubleshooting:', { color: 'cyan' })

  // Provider-specific troubleshooting
  if (provider === 'ollama' || endpoint.includes('11434')) {
    logger.log('  • Is Ollama running? Try: ollama serve', { color: 'white' })
    logger.log('  • Check if the endpoint is correct in your config', { color: 'white' })
    logger.log(`  • Verify Ollama is accessible: curl ${endpoint}/api/version`, { color: 'white' })
  } else if (provider === 'openai' || endpoint.includes('openai')) {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the API endpoint is accessible', { color: 'white' })
    logger.log('  • If using a custom baseURL, verify it is correct', { color: 'white' })
  } else if (provider === 'anthropic') {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the Anthropic API is accessible', { color: 'white' })
  } else {
    logger.log('  • Check your internet connection', { color: 'white' })
    logger.log('  • Verify the service endpoint is correct', { color: 'white' })
    logger.log('  • Ensure the LLM service is running and accessible', { color: 'white' })
  }

  logger.log('  • Run `coco doctor` to verify your configured provider + endpoint', { color: 'white' })

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

  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.log(`\nError: Authentication failed${error.provider ? ` for ${provider}` : ''}`, { color: 'red' })

  if (endpoint) {
    logger.log(`       Endpoint: ${endpoint}`, { color: 'red' })
  }

  logger.log('\nTroubleshooting:', { color: 'cyan' })
  logger.log('  • Verify your API key is correct and has not expired', { color: 'white' })

  // Provider-specific env var hint when we know the provider.
  if (provider === 'openai' || provider === 'OpenAI') {
    logger.log('  • Set `OPENAI_API_KEY` in your shell or `service.authentication.credentials.apiKey` in config', { color: 'white' })
  } else if (provider === 'anthropic' || provider === 'Anthropic') {
    logger.log('  • Set `ANTHROPIC_API_KEY` in your shell or `service.authentication.credentials.apiKey` in config', { color: 'white' })
  } else if (provider === 'ollama' || provider === 'Ollama') {
    logger.log('  • Ollama usually does not need a key — check `service.endpoint` and that `ollama serve` is running', { color: 'white' })
  } else if (provider === 'openai-compatible') {
    logger.log('  • OpenAI-compatible endpoints need both `service.endpoint` and a valid API key', { color: 'white' })
  } else {
    logger.log('  • Ensure the API key is set in your environment or config', { color: 'white' })
  }

  logger.log('  • Run `coco init` to (re)configure your provider + key', { color: 'white' })
  logger.log('  • Run `coco doctor` to inspect the active config sources', { color: 'white' })

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
  logger.log('\nFailed to execute command', { color: 'yellow' })
  logger.log(`\nError: ${error.message}`, { color: 'red' })
  if (error.stack) {
    logger.verbose(`\n${error.stack}`, { color: 'gray' })
  }
}

function commandExecutor<T extends Argv<BaseArgvOptions>['argv']>(handler: CommandHandler<T>) {
  return async (argv: T) => {
    const options = loadConfig(argv)
    // `--quiet` flips the logger silent so coco's status chrome is suppressed.
    // Results still reach stdout (handleResult / emitJson write directly).
    const quiet = (argv as { quiet?: boolean })?.quiet === true
    const logger = new Logger(quiet ? { ...options, silent: true } : options)

    try {
      await handler(argv, logger)
    } catch (error) {
      if (isCommandExitError(error)) {
        process.exitCode = error.code
        return
      }

      // Handle specific error types with helpful messages
      if (error instanceof LangChainNetworkError) {
        formatNetworkError(error, logger)
      } else if (error instanceof LangChainAuthenticationError) {
        formatAuthenticationError(error, logger)
      } else {
        formatGenericError(error as Error, logger)
      }

      logger.log('\nThanks for using coco, make it a great day! 👋🤖', { color: 'blue' })
      process.exitCode = 1
    }
  }
}

export default commandExecutor
